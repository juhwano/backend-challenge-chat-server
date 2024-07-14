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
    // 채팅방 넘버 입장
    socket.join(number);
    console.log(`Client joined room: ${number}`);
    // Add user to chat's user array
    await Chat.findByIdAndUpdate(chatId, { $addToSet: { users: userId } });

    const systemMessage = {
      chatId,
      fromUserName: 'system',
      toUserName: `${userName}`,
      content: `입장`,
      chatNumber: number
    };
    // const chat = new Chat({ chatName, isPersonal, owner, users, number: nextNumber });
    io.to(number).emit('message', systemMessage);
  });

  socket.on('leaveRoom', async ({ chatId, number, userId, userName }) => {
    socket.leave(number);
    console.log(`Client with username ${userName} left room: ${number}`);
    // Remove user from chat's user array
    await Chat.findByIdAndUpdate(chatId, { $pull: { users: userId } });

    const systemMessage = {
      chatId: '',
      fromUserName: 'system',
      toUserName: `${userName}`,
      content: `퇴장`,
      chatNumber: number
    };
    io.to(number).emit('message', systemMessage);
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

app.get('/chats', async (req, res) => {
  const chats = await Chat.find().populate('owner', 'userName');
  res.json(chats);
});

app.get('/chats/:number', async (req, res) => {
  const { number } = req.params;
  const chats = await Chat.findOne({ number }, '_id');
  res.json(chats);
});

app.get('/messages/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const messages = await Message.find({ chatId });
  res.json(messages);
});

app.post('/chats', async (req, res) => {
  const { chatName, isPersonal, owner } = req.body;

  // Find the highest chat number and increment it
  const latestChatNumber = await Chat.findOne().sort({ number: -1 }).exec();
  const nextNumber = latestChatNumber ? latestChatNumber.number + 1 : 1;

  const chat = new Chat({ chatName, isPersonal, owner, number: nextNumber });
  const counter = new Counter({ chatId: chat._id });

  await chat.save();
  await counter.save();
  res.json(chat);
});

async function getNextSequence(chatId) {
  const counter = await Counter.findOneAndUpdate({ chatId }, { $inc: { sequence: 1 } }, { new: true, upsert: true });
  return counter.sequence;
}

async function addUserChatRoom(userId) {}

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
