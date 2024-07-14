const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const amqp = require('amqplib');
require('dotenv').config();

const connectDB = require('./config/db');
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const Counter = require('./models/Counter');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ['GET', 'POST']
  }
});

// Redis setup
const redisClient = new Redis();
const redisPub = redisClient.duplicate();
const redisSub = redisClient.duplicate();

// RabbitMQ setup
let channel;
amqp
  .connect(process.env.RABBITMQ_URL)
  .then((conn) => conn.createChannel())
  .then((ch) => {
    channel = ch;
    channel.assertQueue('chat_messages');
    // Set up the RabbitMQ consumer
    ch.consume('chat_messages', async (msg) => {
      if (msg !== null) {
        const messageContent = JSON.parse(msg.content.toString());
        console.log('MongoDB save messageContent: ', messageContent);

        messageContent.sequence = await getNextSequence(messageContent.chatId);

        const newMessage = new Message(messageContent);
        await newMessage.save();
        ch.ack(msg);
      }
    });
  })
  .catch((err) => console.error('RabbitMQ connection error:', err));

// MongoDB connection
connectDB();

app.use(cors());
app.use(express.json());

// WebSocket connections
io.on('connection', (socket) => {
  console.log('New client socket_id connected: ', socket.userName);

  socket.on('joinRoom', async ({ chatId, number, userId, userName }) => {
    // Check if the user is already in the chat's user list
    const chat = await Chat.findById(chatId);

    if (!chat.users.includes(userId)) {
      // Add user to chat's user array if not already present
      await Chat.findByIdAndUpdate(chatId, { $addToSet: { users: userId } });

      const systemMessage = {
        chatId,
        fromUserName: 'system',
        toUserName: `${userName}`,
        content: `입장`,
        chatNumber: number
      };
      io.to(number).emit('message', systemMessage);
    }

    socket.join(number);
    console.log(`Client joined room: ${number}`);
  });

  socket.on('leaveRoom', async ({ chatId, number, userId, userName }) => {
    socket.leave(number);
    console.log(`Client with username ${userName} left room: ${number}`);
    // Remove user from chat's user array
    const chat = await Chat.findByIdAndUpdate(chatId, { $pull: { users: userId } }, { new: true });

    const systemMessage = {
      chatId: '',
      fromUserName: 'system',
      toUserName: `${userName}`,
      content: `퇴장`,
      chatNumber: number
    };
    io.to(number).emit('message', systemMessage);

    if (chat.users.length === 0) {
      await Chat.findByIdAndUpdate(chat._id, { active: false, deletedAt: new Date() });
      console.log(`Removed empty room: ${number}`);
    }
  });

  socket.on('sendMessage', (message) => {
    console.log('redis message: ', socket);
    redisPub.publish('chat_message', JSON.stringify(message));
    channel.sendToQueue('chat_messages', Buffer.from(JSON.stringify(message)));
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

redisSub.subscribe('chat_message', (err, count) => {
  if (err) {
    console.error('Failed to subscribe: %s', err.message);
  } else {
    console.log(`Subscribed successfully! This client is currently subscribed to ${count} channels.`);
  }
});

redisSub.on('message', (channel, message) => {
  const parsedMessage = JSON.parse(message);
  io.to(parsedMessage.chatNumber).emit('message', parsedMessage);
});

// API routes
app.post('/login', async (req, res) => {
  const { userName } = req.body;
  const user = await User.findOneAndUpdate({ userName }, { userName, active: true }, { upsert: true, new: true });
  res.json(user);
});

app.post('/logout', async (req, res) => {
  const { userName } = req.body;
  await User.findOneAndUpdate({ userName }, { active: false });
  res.json({ message: 'Logout successful' });
});

app.get('/users', async (req, res) => {
  const users = await User.find({ active: true }, 'userName');
  res.json(users);
});

app.get('/users/search', async (req, res) => {
  const { query } = req.query;
  const users = await User.find({ userName: new RegExp(query, 'i') }, 'userName active');
  res.json(users);
});

app.get('/chats', async (req, res) => {
  try {
    const chats = await Chat.find({ isPersonal: false, active: true }).populate('owner', 'userName').sort({ _id: -1 }); // Sort by creation date in descending order
    res.json(chats);
  } catch (error) {
    console.error('Error fetching group chats:', error);
    res.status(500).json({ error: 'Error fetching group chats' });
  }
});

app.get('/chats/:number', async (req, res) => {
  const { number } = req.params;
  const chats = await Chat.findOne({ number }, '_id, users');
  res.json(chats);
});

// Fetch 1:1 chats for a specific user
app.get('/chats/one-to-one/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const chats = await Chat.find({ isPersonal: true, users: { $in: [userId] } })
      .populate('owner', 'userName')
      .sort({ _id: -1 }); // Sort by creation date in descending order
    res.json(chats);
  } catch (error) {
    console.error('Error fetching 1:1 chats:', error);
    res.status(500).json({ error: 'Error fetching 1:1 chats' });
  }
});

// Fetch group chats for a specific user
app.get('/chats/group/:userId', async (req, res) => {
  const { userId } = req.params;
  const chats = await Chat.find({ isPersonal: false, users: userId }).populate('owner', 'userName');
  res.json(chats);
});

app.get('/messages/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const messages = await Message.find({ chatId });
  res.json(messages);
});

app.post('/chats', async (req, res) => {
  const { chatName, isPersonal, owner, users } = req.body;
  console.log('owner, users: ', owner, users);
  let chat;

  try {
    // Find the highest chat number and increment it
    const latestChatNumber = await Chat.findOne().sort({ number: -1 }).exec();
    const nextNumber = latestChatNumber ? latestChatNumber.number + 1 : 1;

    if (isPersonal) {
      // Check for an existing chat
      chat = await Chat.findOne({ isPersonal: true, users: { $all: [...users] } });

      if (chat) {
        // Reactivate the chat if it was marked as deleted
        if (chat.deletedAt !== null) {
          chat.deletedAt = null;
          chat.active = true;
          await chat.save();
          return res.json(chat);
        } else {
          return res.json(chat);
        }
      }

      // Create a new chat if no existing chat is found
      chat = new Chat({ chatName, isPersonal, owner, users: [...users], number: nextNumber });
    } else {
      chat = new Chat({ chatName, isPersonal, owner, number: nextNumber });
    }

    const counter = new Counter({ chatId: chat._id });

    await chat.save();
    await counter.save();
    res.json(chat);
  } catch (error) {
    if (error.code === 11000) {
      chat = await Chat.findOne({ chatName });
      if (chat) {
        if (chat.deletedAt !== null) {
          chat.deletedAt = null;
          chat.active = true;
          chat.users = [...users];
          await chat.save();
        }
        return res.json(chat);
      }
    }
    console.error('Error creating chat:', error);
    res.status(500).json({ error: 'An error occurred while creating the chat.' });
  }
});

async function getNextSequence(chatId) {
  const counter = await Counter.findOneAndUpdate({ chatId }, { $inc: { sequence: 1 } }, { new: true, upsert: true });
  return counter.sequence;
}

async function addUserChatRoom(userId) {}

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
