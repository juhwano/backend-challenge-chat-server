const Chat = require('../models/Chat');
const Counter = require('../models/Counter');
const User = require('../models/User');

exports.getChats = async (req, res) => {
  const { page = 1, limit = 6 } = req.query;
  try {
    const chats = await Chat.find({ isPersonal: false, active: true })
      .populate('owner', 'userName')
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Chat.countDocuments({ isPersonal: false, active: true });

    res.json({
      chats,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error('Error fetching group chats:', error);
    res.status(500).json({ error: 'Error fetching group chats' });
  }
};

exports.getOneToOneChats = async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 4 } = req.query;
  try {
    const chats = await Chat.find({ isPersonal: true, users: { $in: [userId] } })
      .populate('owner', 'userName')
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Chat.countDocuments({ isPersonal: true, users: { $in: [userId] } });

    res.json({
      chats,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error('Error fetching 1:1 chats:', error);
    res.status(500).json({ error: 'Error fetching 1:1 chats' });
  }
};

exports.getChatByNumber = async (req, res) => {
  const { number } = req.params;
  const chats = await Chat.findOne({ number, active: true }, '_id users isPersonal chatName');
  res.json(chats);
};

exports.createChat = async (req, res) => {
  const { chatName, isPersonal, owner, users } = req.body;
  let chat;

  try {
    const latestChatNumber = await Chat.findOne().sort({ number: -1 }).exec();
    const nextNumber = latestChatNumber ? latestChatNumber.number + 1 : 1;

    if (isPersonal) {
      chat = await Chat.findOne({ isPersonal: true, users: { $all: [...users] } });

      if (chat) {
        if (chat.deletedAt !== null) {
          chat.deletedAt = null;
          chat.active = true;
          await chat.save();
          return res.json(chat);
        } else {
          return res.json(chat);
        }
      }
    }

    chat = new Chat({ chatName, isPersonal, owner, users: [...users], number: nextNumber });

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
};

exports.getGroupChatsByUser = async (req, res) => {
  const { userId } = req.params;
  const chats = await Chat.find({ isPersonal: false, users: userId }).populate('owner', 'userName');
  res.json(chats);
};
