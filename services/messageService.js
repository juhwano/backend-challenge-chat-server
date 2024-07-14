const User = require('../models/User');
const Counter = require('../models/Counter');

async function getNextSequence(chatId) {
  const counter = await Counter.findOneAndUpdate({ chatId }, { $inc: { sequence: 1 } }, { new: true, upsert: true });
  return counter.sequence;
}

async function getToUserName(toUserId) {
  const user = await User.findById(toUserId);
  return user ? user.userName : 'Unknown';
}

module.exports = {
  getNextSequence,
  getToUserName
};
