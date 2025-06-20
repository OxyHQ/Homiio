/**
 * Authentication Routes
 * API routes for user authentication and authorization
 */

const express = require('express');
const { authController } = require('../controllers');
const { auth, validation } = require('../middlewares');

const router = express.Router();

// Public authentication routes
router.post('/login', validation.validateLogin, authController.login);
router.post('/register', validation.validateRegister, authController.register);
router.post('/refresh', validation.validateRefreshToken, authController.refreshToken);

// Protected routes
router.get('/validate', auth.verifyToken, authController.validateToken);
router.post('/logout', auth.verifyToken, authController.logout);

// Password management
router.post('/forgot-password', validation.validateEmail, authController.forgotPassword);
router.post('/reset-password', validation.validatePasswordReset, authController.resetPassword);

module.exports = router;