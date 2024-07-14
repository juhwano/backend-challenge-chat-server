const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/', userController.getUsers);
router.post('/login', userController.login);
router.post('/logout', userController.logout);
router.get('/search', userController.searchUsers);

module.exports = router;
