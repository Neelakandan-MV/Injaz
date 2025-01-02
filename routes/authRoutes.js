const express = require('express');
const router = express.Router();
const loginController = require('../controllers/loginController');

// Show login page
router.get('/login', loginController.showLoginPage);

// Handle login request for both admin and business owners
router.post('/login', loginController.login);

module.exports = router;
