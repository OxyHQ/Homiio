/**
 * Profile Routes
 * API routes for profile management
 */

const express = require("express");
const profileController = require("../controllers/profileController");
const { asyncHandler } = require("../middlewares");
const performanceMonitor = require("../middlewares/performance");

module.exports = function () {
  const router = express.Router();

  // Performance monitoring for all profile routes
  router.use(performanceMonitor);

  // Profile routes
  router.get("/me", asyncHandler(profileController.getOrCreateActiveProfile));
  router.get("/me/all", asyncHandler(profileController.getUserProfiles));
  router.get("/me/recent-properties", asyncHandler(profileController.getRecentProperties));
  router.get("/me/recent-properties/debug", asyncHandler(profileController.debugRecentProperties));
  router.delete("/me/recent-properties", asyncHandler(profileController.clearRecentProperties));
  router.get("/me/saved-properties", asyncHandler(profileController.getSavedProperties));
  router.post("/me/save-property", asyncHandler(profileController.saveProperty));
  router.delete("/me/saved-properties/:propertyId", asyncHandler(profileController.unsaveProperty));
  router.put("/me/saved-properties/:propertyId/notes", asyncHandler(profileController.updateSavedPropertyNotes));
  router.get("/me/saved-searches", asyncHandler(profileController.getSavedSearches));
  router.post("/me/saved-searches", asyncHandler(profileController.saveSearch));
  router.delete("/me/saved-searches/:searchId", asyncHandler(profileController.deleteSavedSearch));
  router.put("/me/saved-searches/:searchId", asyncHandler(profileController.updateSavedSearch));
  router.put("/me/saved-searches/:searchId/notifications", asyncHandler(profileController.toggleSearchNotifications));
  router.get("/me/:profileType", asyncHandler(profileController.getProfileByType));
  router.get("/:profileId", asyncHandler(profileController.getProfileById));
  router.post("/", asyncHandler(profileController.createProfile));
  router.put("/:profileId", asyncHandler(profileController.updateProfile));
  router.delete("/:profileId", asyncHandler(profileController.deleteProfile));
  router.post("/:profileId/activate", asyncHandler(profileController.activateProfile));

  return router;
}; 