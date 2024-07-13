const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    userName: { type: String, unique: true, required: true },
    active: { type: Boolean, default: false }, // 사용자 접속 상태
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

const User = mongoose.model('User', userSchema);

module.exports = User;
