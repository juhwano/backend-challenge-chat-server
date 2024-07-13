const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
  {
    chatName: { type: String, unique: true, required: true },
    number: { type: Number, unique: true, required: true },
    active: { type: Boolean, default: true },
    isPersonal: { type: Boolean, default: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
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

const Chat = mongoose.model('Chat', chatSchema);

module.exports = Chat;
