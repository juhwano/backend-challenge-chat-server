const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // 보낸 사람
    to: { type: mongoose.Schema.Types.ObjectId, default: null }, // 받는 사람
    content: { type: String, required: true }, // 내용
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
