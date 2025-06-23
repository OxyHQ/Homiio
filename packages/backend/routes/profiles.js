/**
 * Profile Routes
 * API routes for profile management
 */

const express = require("express");
const profileController = require("../controllers/profileController");
const { validation, asyncHandler } = require("../middlewares");
const performanceMonitor = require("../middlewares/performance");

module.exports = function (authenticateToken) {
  const router = express.Router();

  // Performance monitoring for all profile routes
  router.use(performanceMonitor);

  // Protected routes (all profile routes require authentication)
  router.use(authenticateToken);

  // Primary profile routes
  router.get("/me", asyncHandler(profileController.getOrCreatePrimaryProfile));
  router.get("/me/all", asyncHandler(profileController.getUserProfiles));
  router.get("/me/:profileType", asyncHandler(profileController.getProfileByType));
  router.put("/me", asyncHandler(profileController.updatePrimaryProfile));

  // Profile management
  router.post("/", asyncHandler(profileController.createProfile));
  router.put("/:profileId", asyncHandler(profileController.updateProfile));
  router.patch("/:profileId/activate", asyncHandler(profileController.activateProfile));
  router.delete("/:profileId", asyncHandler(profileController.deleteProfile));

  // Agency-specific routes
  router.get("/me/agency-memberships", asyncHandler(profileController.getAgencyMemberships));
  router.post("/:profileId/members", asyncHandler(profileController.addAgencyMember));
  router.delete("/:profileId/members/:memberOxyUserId", asyncHandler(profileController.removeAgencyMember));

  // Trust score routes
  router.patch("/:profileId/trust-score", asyncHandler(profileController.updateTrustScore));
  router.patch("/me/trust-score", asyncHandler(profileController.updatePrimaryTrustScore));
  router.post("/me/trust-score/recalculate", asyncHandler(profileController.recalculatePrimaryTrustScore));
  router.get("/me/trust-score", asyncHandler(profileController.getTrustScore));

  return router;
}; 