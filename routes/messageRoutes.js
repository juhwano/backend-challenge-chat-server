const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

router.get('/:chatId', messageController.getMessagesByChatId);

module.exports = router;
