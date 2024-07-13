const express = require('express');
const http = require('http');
const Redis = require('ioredis');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const connectDB = require('./config/db');
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const Counter = require('./models/Counter');
const { JSDOM } = require('jsdom');
const DOMPurify = require('dompurify')(new JSDOM().window);

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

const redisClient = new Redis();
const redisPub = redisClient.duplicate();
const redisSub = redisClient.duplicate();

app.use(cors());
app.use(express.json());

connectDB();

redisClient.on('error', (err) => console.error('Redis client error:', err));
redisSub.on('error', (err) => console.error('Redis subClient error:', err));

const connectedUsers = new Map();
const userChats = new Map();

app.post('/login', async (req, res) => {
  const { userName } = req.body;
  const user = await User.findOneAndUpdate({ userName }, { userName, active: true }, { upsert: true, new: true });
  res.json(user);
});

app.post('/logout', async (req, res) => {
  const { userName } = req.body;
  try {
    await User.findOneAndUpdate({ userName }, { active: false });
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await User.find({ active: true }, 'userName');
    res.json(users.map((user) => user.userName));
  } catch (error) {
    console.error('Error fetching users', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/chats', async (req, res) => {
  try {
    const chats = await Chat.find({ deletedAt: null }).populate('owner', 'userName');
    res.json(chats);
  } catch (error) {
    console.error('Error fetching chats', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/chats/:number', async (req, res) => {
  const { number } = req.params;
  const chat = await Chat.findOne({ number });
  res.json(chat);
});

app.post('/chats', async (req, res) => {
  try {
    const { chatName, isPersonal, owner, user } = req.body;
    const ownerUser = await User.findOne({ userName: owner });

    if (!ownerUser) {
      return res.status(404).json({ message: 'Owner user not found' });
    }

    if (isPersonal) {
      const targetUser = await User.findOne({ userName: user });
      if (!targetUser) {
        return res.status(404).json({ message: 'Target user not found' });
      }

      let chat = await Chat.findOne({
        isPersonal: true,
        users: { $all: [ownerUser._id, targetUser._id] }
      });

      if (chat) {
        return res.json(chat);
      }

      const chatObject = await Chat.findOne().sort({ number: -1 });
      const lastChatNumber = chatObject ? chatObject.number + 1 : 1;

      chat = new Chat({
        chatName: `${targetUser.userName}`,
        number: lastChatNumber,
        isPersonal,
        owner: ownerUser._id,
        users: [ownerUser._id, targetUser._id],
        deletedAt: null
      });

      await chat.save();

      // Notify the target user about the new 1:1 chat
      const targetSocketId = connectedUsers.get(targetUser.userName);
      if (targetSocketId) {
        io.to(targetSocketId).emit('new1to1chat', chat);
      }

      res.status(201).json(chat);
    } else {
      const chatObject = await Chat.findOne().sort({ number: -1 });
      const lastChatNumber = chatObject ? chatObject.number + 1 : 1;

      const chat = new Chat({
        chatName,
        number: lastChatNumber,
        isPersonal,
        owner: ownerUser._id,
        users: [ownerUser._id],
        deletedAt: null
      });

      await chat.save();

      res.status(201).json(chat);
    }
  } catch (error) {
    console.error('Error creating chat room:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.get('/messages/:chatId', async (req, res) => {
  const { chatId } = req.params;
  try {
    const messages = await Message.find({ chatId }).sort({ sequence: 1 });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function getNextSequence(chatId) {
  const counter = await Counter.findOneAndUpdate({ chatId }, { $inc: { sequence: 1 } }, { new: true, upsert: true });
  return counter.sequence;
}

function setUserActive(userName) {
  redisClient.set(`user:${userName}:active`, true);
  redisClient.expire(`user:${userName}:active`, 60 * 60); // 1 hour expiry
}

function setUserInactive(userName) {
  redisClient.del(`user:${userName}:active`);
}

app.post('/message', async (req, res) => {
  let { from, to, content, chatType, number } = req.body;

  try {
    content = content.trim();
    if (!content) {
      return res.status(400).json({ error: 'Message content cannot be empty' });
    }

    content = DOMPurify.sanitize(content);

    if (content.length > 1000) {
      return res.status(400).json({ error: 'Message too long. Max 1000 characters.' });
    }

    const chat = await Chat.findOne({ number });
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (chatType === 'group' && io.sockets.adapter.rooms.get(chat._id.toString())?.size > 100) {
      return res.status(400).json({ error: 'Group chat limit reached. Max 100 users.' });
    }

    const sequence = await getNextSequence(chat._id);

    const fromUser = await User.findOne({ userName: from });
    const toUser = to ? await User.findOne({ userName: to }) : null;

    const messageObject = {
      chatId: chat._id,
      from: fromUser ? fromUser._id : null,
      fromUserName: fromUser ? fromUser.userName : 'System',
      to: toUser ? toUser._id : null,
      toUserName: toUser ? toUser.userName : null,
      content,
      sequence,
      timestamp: new Date()
    };

    const chatMessage = new Message(messageObject);
    await chatMessage.save();

    io.to(chat._id.toString()).emit('newMessage', messageObject);
    redisPub.publish('chat_messages', JSON.stringify(messageObject));

    if (fromUser) {
      await User.findOneAndUpdate({ userName: from }, { active: true });
      setUserActive(from);
    }

    res.status(201).json(messageObject);
  } catch (error) {
    console.error('Error sending message:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('register', (userName) => {
    connectedUsers.set(userName, socket.id);
    console.log(`User ${userName} connected with socket ID: ${socket.id}`);
  });

  socket.on('joinChat', async ({ number, userName }) => {
    console.log(`User ${userName} joining chat number: ${number}`);
    const chat = await Chat.findOne({ number });
    if (chat) {
      socket.join(chat._id.toString());
      socket.currentChat = chat._id.toString();
      socket.userName = userName;
      userChats.set(userName, chat._id.toString());
      connectedUsers.set(userName, socket.id);

      const user = await User.findOneAndUpdate({ userName }, { active: true });
      if (!chat.users.includes(user._id)) {
        chat.users.push(user._id);
        await chat.save();
      }

      socket.emit('joinedChat', chat);

      const usersInChat = await User.find({ _id: { $in: chat.users } }, 'userName active');

      const systemMessage = {
        chatId: chat._id,
        fromUserName: 'System',
        content: `${userName} has joined the chat.`,
        sequence: await getNextSequence(chat._id),
        timestamp: new Date()
      };

      await new Message(systemMessage).save();

      io.to(chat._id.toString()).emit('newMessage', systemMessage);
      io.to(chat._id.toString()).emit('connectedUsers', usersInChat);
    } else {
      socket.emit('error', 'Chat not found');
    }
  });

  socket.on('leaveChat', async ({ number, userName }) => {
    console.log(`User ${userName} leaving chat number: ${number}`);
    const chat = await Chat.findOne({ number });
    if (chat) {
      socket.leave(chat._id.toString());
      userChats.delete(userName);

      // Find the user and remove them from the chat's users array
      const user = await User.findOne({ userName });
      if (user) {
        chat.users = chat.users.filter((userId) => !userId.equals(user._id));
        await chat.save();
      }

      const usersInChat = await User.find({ _id: { $in: chat.users } }, 'userName active');

      const systemMessage = {
        chatId: chat._id,
        fromUserName: 'System',
        content: `${userName} has left the chat.`,
        sequence: await getNextSequence(chat._id),
        timestamp: new Date()
      };

      await new Message(systemMessage).save();

      io.to(chat._id.toString()).emit('newMessage', systemMessage);
      io.to(chat._id.toString()).emit('connectedUsers', usersInChat);

      if (usersInChat.length === 0) {
        chat.active = false;
        chat.deletedAt = new Date();
        await chat.save();
      }
    } else {
      socket.emit('error', 'Chat not found');
    }
  });

  socket.on('sendMessage', async (data) => {
    try {
      const response = await axios.post('http://localhost:5050/message', data);
      if (response.status === 201) {
        console.log('Message sent successfully');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', error.response?.data?.error || 'Error sending message');
    }
  });

  socket.on('requestGroupChats', async () => {
    const chats = await Chat.find();
    socket.emit('groupChatsList', chats);
  });

  socket.on('disconnect', async () => {
    if (socket.userName) {
      const chatId = userChats.get(socket.userName);
      const chat = await Chat.findById(chatId);
      if (chat) {
        const user = await User.findOne({ userName: socket.userName });
        chat.users.pull(user._id);
        await chat.save();

        const usersInChat = await User.find({ _id: { $in: chat.users } }, 'userName active');

        const systemMessage = {
          chatId: chat._id,
          fromUserName: 'System',
          content: `${socket.userName} has left the chat.`,
          sequence: await getNextSequence(chat._id),
          timestamp: new Date()
        };

        await new Message(systemMessage).save();

        io.to(chat._id.toString()).emit('newMessage', systemMessage);
        io.to(chat._id.toString()).emit('connectedUsers', usersInChat);

        if (usersInChat.length === 0) {
          chat.deletedAt = new Date();
          await chat.save();
        }
      }

      userChats.delete(socket.userName);
      connectedUsers.delete(socket.userName);
      await User.findOneAndUpdate({ userName: socket.userName }, { active: false });
      io.emit('userStatus', { userName: socket.userName, active: false });
    }
    console.log('Client disconnected');
  });
});

redisSub.subscribe('chat_messages');
redisSub.on('message', (channel, message) => {
  const parsedMessage = JSON.parse(message);
  if (parsedMessage.chatType === '1:1') {
    const receiverSocketId = connectedUsers.get(parsedMessage.to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('newMessage', parsedMessage);
    }
  } else if (parsedMessage.chatType === 'group') {
    io.to(parsedMessage.chatId).emit('newMessage', parsedMessage);
  }
});

const PORT = process.env.PORT || 5050;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
