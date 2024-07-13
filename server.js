require('dotenv').config();
const express = require('express');
const http = require('http');
const Redis = require('ioredis');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const connectDB = require('./config/db');
const User = require('./models/User');
const Room = require('./models/Room');
const Message = require('./models/Message');

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

// Connect to MongoDB
connectDB();

redisClient.on('error', (err) => console.error('Redis client error:', err));
redisSub.on('error', (err) => console.error('Redis subClient error:', err));

const connectedUsers = new Map();
const userRooms = new Map();

app.post('/login', async (req, res) => {
  const { userName } = req.body;
  const user = await User.findOneAndUpdate({ userName }, { userName, active: true }, { upsert: true, new: true });
  res.json(user);
});

app.get('/rooms', async (req, res) => {
  const rooms = await Room.find();
  res.json(rooms);
});

app.get('/room/:number', async (req, res) => {
  const { number } = req.params;
  const room = await Room.findOne({ number });
  res.json(room);
});

async function getNextSequence(roomId) {
  const room = await Room.findById(roomId);
  const sequence = room.sequence || 0;
  room.sequence = sequence + 1;
  await room.save();
  return room.sequence;
}

function setUserActive(userName) {
  redisClient.set(`user:${userName}:active`, true);
  redisClient.expire(`user:${userName}:active`, 60 * 5);
}

function setUserInactive(userName) {
  redisClient.del(`user:${userName}:active`);
}

app.post('/send-message', async (req, res) => {
  const { from, to, content, chatType, number } = req.body;

  try {
    if (content.length > 1000) {
      return res.status(400).json({ error: 'Message too long. Max 1000 characters.' });
    }

    const room = await Room.findOne({ number });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (chatType === 'group' && io.sockets.adapter.rooms.get(room._id.toString())?.size > 100) {
      return res.status(400).json({ error: 'Group chat limit reached. Max 100 users.' });
    }

    const sequence = await getNextSequence(room._id);

    const fromUser = await User.findOne({ userName: from });
    const toUser = to ? await User.findOne({ userName: to }) : null;

    const messageObject = {
      roomId: room._id,
      from: fromUser._id,
      fromUserName: fromUser.userName,
      to: toUser ? toUser._id : null,
      toUserName: toUser ? toUser.userName : null,
      content,
      sequence,
      timestamp: new Date()
    };

    const chatMessage = new Message(messageObject);
    await chatMessage.save();

    // Broadcast the message to the room
    io.to(room._id.toString()).emit('newMessage', messageObject);

    // Publish to Redis for other servers
    redisPub.publish('chat_messages', JSON.stringify(messageObject));

    res.status(201).json(messageObject);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('joinRoom', async ({ number, userName }) => {
    console.log(`User ${userName} joining room number: ${number}`);
    const room = await Room.findOne({ number });
    if (room) {
      socket.join(room._id.toString());
      socket.currentRoom = room._id.toString();
      userRooms.set(userName, room._id.toString());
      socket.emit('roomJoined', room);

      const usersInRoom = [...userRooms.entries()]
        .filter(([_, r]) => r === room._id.toString())
        .map(([userName]) => ({ userName, socketId: connectedUsers.get(userName) }));

      io.to(room._id.toString()).emit('newMessage', {
        content: `${userName} has joined the room.`,
        timestamp: new Date(),
        room: room._id.toString()
      });

      io.to(room._id.toString()).emit('connectedUsers', usersInRoom);
    } else {
      socket.emit('error', 'Room not found');
    }
  });

  socket.on('leaveRoom', async ({ number, userName }) => {
    console.log(`User ${userName} leaving room number: ${number}`);
    const room = await Room.findOne({ number });
    if (room) {
      socket.leave(room._id.toString());
      userRooms.delete(userName);

      const usersInRoom = [...userRooms.entries()]
        .filter(([_, r]) => r === room._id.toString())
        .map(([userName]) => ({ userName, socketId: connectedUsers.get(userName) }));

      io.to(room._id.toString()).emit('newMessage', {
        sender: 'System',
        content: `${userName} has left the room.`,
        timestamp: new Date(),
        room: room._id.toString()
      });

      io.to(room._id.toString()).emit('connectedUsers', usersInRoom);
    } else {
      socket.emit('error', 'Room not found');
    }
  });

  socket.on('sendMessage', async (data) => {
    try {
      const response = await axios.post('http://localhost:5050/send-message', data);
      if (response.status === 201) {
        console.log('Message sent successfully');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', error.response?.data?.error || 'Error sending message');
    }
  });

  socket.on('requestGroupRooms', async () => {
    const rooms = await Room.find();
    socket.emit('groupRoomsList', rooms);
  });

  socket.on('disconnect', async () => {
    if (socket.userName) {
      const roomId = userRooms.get(socket.userName);
      userRooms.delete(socket.userName);

      if (roomId) {
        const usersInRoom = [...userRooms.entries()]
          .filter(([_, r]) => r === roomId)
          .map(([userName]) => ({ userName, socketId: connectedUsers.get(userName) }));

        io.to(roomId).emit('newMessage', {
          sender: 'System',
          content: `${socket.userName} has left the room.`,
          timestamp: new Date(),
          room: roomId
        });

        io.to(roomId).emit('connectedUsers', usersInRoom);
      }

      connectedUsers.delete(socket.userName);
      await User.findOneAndUpdate({ userName: socket.userName }, { active: false });
      io.emit('userStatus', { userName: socket.userName, status: 'offline' });
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
    io.to(parsedMessage.roomId).emit('newMessage', parsedMessage);
  }
});

const PORT = process.env.PORT || 5050;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
