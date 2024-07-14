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
  console.log('New client socket_id connected: ', socket.client.id);

  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`Client joined room: ${room}`);
  });

  socket.on('sendMessage', (message) => {
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

app.get('/chats/:number/messages', async (req, res) => {
  const { number } = req.params;
  const messages = await Message.find({ chatNumber: number });
  res.json(messages);
});

app.post('/chats', async (req, res) => {
  const { chatName, isPersonal, owner, users } = req.body;
  const chat = new Chat({ chatName, isPersonal, owner, users });
  await chat.save();
  res.json(chat);
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
