const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

router.get('/', chatController.getChats);
router.post('/', chatController.createChat);
router.get('/one-to-one/:userId', chatController.getOneToOneChats);
router.get('/group/:userId', chatController.getGroupChatsByUser);
router.get('/:number', chatController.getChatByNumber);

module.exports = router;
