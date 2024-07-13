const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, unique: true },
  sequence: { type: Number, default: 0 } //메시지 순서(개수)
});

const Counter = mongoose.model('Counter', counterSchema);

module.exports = Counter;
