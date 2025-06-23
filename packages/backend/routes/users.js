/**
 * User Routes
 * API routes for user management
 */

const express = require("express");
const { userController } = require("../controllers");
const { validation, asyncHandler } = require("../middlewares");

module.exports = function (authenticateToken) {
  const router = express.Router();

  // Protected routes (all user routes require authentication)
  router.use(authenticateToken);

  // User profile routes
  router.get("/me", asyncHandler(userController.getCurrentUser));
  router.put("/me", validation.validateUser, asyncHandler(userController.updateCurrentUser));
  router.delete("/me", asyncHandler(userController.deleteCurrentUser));

  // User management (admin only) - Note: Admin authorization will be handled in controller
  router.get("/", asyncHandler(userController.getUsers));
  router.get(
    "/:userId",
    validation.validateId("userId"),
    asyncHandler(userController.getUserById),
  );
  router.put(
    "/:userId",
    validation.validateId("userId"),
    validation.validateUser,
    asyncHandler(userController.updateUser),
  );
  router.delete(
    "/:userId",
    validation.validateId("userId"),
    asyncHandler(userController.deleteUser),
  );

  // User properties
  router.get("/me/properties", asyncHandler(userController.getUserProperties));
  router.get("/me/recent-properties", asyncHandler(userController.getRecentProperties));

  // User notifications
  router.get("/me/notifications", asyncHandler(userController.getUserNotifications));
  router.patch(
    "/me/notifications/:notificationId/read",
    validation.validateId("notificationId"),
    asyncHandler(userController.markNotificationAsRead),
  );

  // Saved properties
  router.get('/me/saved-properties', asyncHandler(userController.getSavedProperties));
  router.post('/me/saved-properties', asyncHandler(userController.saveProperty));
  router.delete('/me/saved-properties/:propertyId', asyncHandler(userController.unsaveProperty));
  router.patch('/me/saved-properties/:propertyId/notes', asyncHandler(userController.updateSavedPropertyNotes));

  return router;
};
