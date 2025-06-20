/**
 * User Routes
 * API routes for user management
 */

const express = require('express');
const { userController } = require('../controllers');
const { auth, validation } = require('../middlewares');

const router = express.Router();

// Protected routes (all user routes require authentication)
router.use(auth.verifyToken);

// User profile routes
router.get('/me', userController.getCurrentUser);
router.put('/me', validation.validateUser, userController.updateCurrentUser);
router.delete('/me', userController.deleteCurrentUser);

// User management (admin only)
router.get('/', auth.authorize(['admin']), userController.getUsers);
router.get('/:userId', validation.validateId('userId'), userController.getUserById);
router.put('/:userId', 
  validation.validateId('userId'),
  auth.authorize(['admin']),
  validation.validateUser,
  userController.updateUser
);
router.delete('/:userId', 
  validation.validateId('userId'),
  auth.authorize(['admin']),
  userController.deleteUser
);

// User properties
router.get('/me/properties', userController.getUserProperties);

// User notifications
router.get('/me/notifications', userController.getUserNotifications);
router.patch('/me/notifications/:notificationId/read', 
  validation.validateId('notificationId'),
  userController.markNotificationAsRead
);

module.exports = router;