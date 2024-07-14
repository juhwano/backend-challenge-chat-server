const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    fromUserName: { type: String }, //보낸 사람
    to: { type: mongoose.Schema.Types.ObjectId, default: null },
    toUserName: { type: String, default: null }, // 받는 사람
    content: { type: String }, // 내용
    sequence: { type: Number }, // 순서
    deletedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      getters: true
    },
    toObject: {
      virtuals: true,
      getter: true
    }
  }
);

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
