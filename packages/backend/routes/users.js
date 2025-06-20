/**
 * User Routes
 * API routes for user management
 */

const express = require("express");
const { userController } = require("../controllers");
const { validation } = require("../middlewares");

module.exports = function (authenticateToken) {
  const router = express.Router();

  // Protected routes (all user routes require authentication)
  router.use(authenticateToken);

  // User profile routes
  router.get("/me", userController.getCurrentUser);
  router.put("/me", validation.validateUser, userController.updateCurrentUser);
  router.delete("/me", userController.deleteCurrentUser);

  // User management (admin only) - Note: Admin authorization will be handled in controller
  router.get("/", userController.getUsers);
  router.get(
    "/:userId",
    validation.validateId("userId"),
    userController.getUserById,
  );
  router.put(
    "/:userId",
    validation.validateId("userId"),
    validation.validateUser,
    userController.updateUser,
  );
  router.delete(
    "/:userId",
    validation.validateId("userId"),
    userController.deleteUser,
  );

  // User properties
  router.get("/me/properties", userController.getUserProperties);
  router.get("/me/recent-properties", userController.getRecentProperties);

  // User notifications
  router.get("/me/notifications", userController.getUserNotifications);
  router.patch(
    "/me/notifications/:notificationId/read",
    validation.validateId("notificationId"),
    userController.markNotificationAsRead,
  );

  // Saved properties
  router.get('/me/saved-properties', authenticateToken, userController.getSavedProperties);
  router.post('/me/saved-properties', authenticateToken, userController.saveProperty);
  router.delete('/me/saved-properties/:propertyId', authenticateToken, userController.unsaveProperty);
  router.patch('/me/saved-properties/:propertyId/notes', authenticateToken, userController.updateSavedPropertyNotes);

  return router;
};
