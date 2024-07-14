const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const amqp = require('amqplib');
require('dotenv').config();

const connectDB = require('./config/db');
const chatRoutes = require('./routes/chatRoutes');
const messageRoutes = require('./routes/messageRoutes');
const userRoutes = require('./routes/userRoutes');
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const { getToUserName, getNextSequence } = require('./services/messageService');

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
        if (messageContent.to) {
          messageContent.toUserName = await getToUserName(messageContent.to);
        }
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

app.use('/chats', chatRoutes);
app.use('/messages', messageRoutes);
app.use('/users', userRoutes);

// WebSocket connections
io.on('connection', (socket) => {
  socket.on('joinRoom', async ({ chatId, number, userId, userName }) => {
    const chat = await Chat.findById(chatId);

    if (!chat.users.includes(userId)) {
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
  });

  socket.on('leaveRoom', async ({ chatId, number, userId, userName }) => {
    socket.leave(number);
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
    }
  });

  socket.on('sendMessage', (message) => {
    redisPub.publish('chat_message', JSON.stringify(message));
    channel.sendToQueue('chat_messages', Buffer.from(JSON.stringify(message)));
  });

  socket.on('disconnect', () => {});
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

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
