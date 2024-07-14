const User = require('../models/User');

exports.login = async (req, res) => {
  const { userName } = req.body;
  const user = await User.findOneAndUpdate({ userName }, { userName, active: true }, { upsert: true, new: true });
  res.json(user);
};

exports.logout = async (req, res) => {
  const { userName } = req.body;
  await User.findOneAndUpdate({ userName }, { active: false });
  res.json({ message: 'Logout successful' });
};

exports.getUsers = async (req, res) => {
  const users = await User.find({ active: true }, 'userName');
  res.json(users);
};

exports.searchUsers = async (req, res) => {
  const { query } = req.query;
  const users = await User.find({ userName: new RegExp(query, 'i') }, 'userName active');
  res.json(users);
};
