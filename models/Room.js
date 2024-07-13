const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    roomName: { type: String, unique: true, required: true },
    number: { type: Number, unique: true, required: true },
    active: { type: Boolean, default: false },
    isPersonal: { type: Boolean, default: true },
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

const Room = mongoose.model('Room', roomSchema);

module.exports = Room;
