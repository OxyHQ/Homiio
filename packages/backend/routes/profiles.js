/**
 * Profile Routes
 * API routes for profile management
 */

const express = require("express");
const profileController = require("../controllers/profileController");
const { validation } = require("../middlewares");
const performanceMonitor = require("../middlewares/performance");

module.exports = function (authenticateToken) {
  const router = express.Router();

  // Performance monitoring for all profile routes
  router.use(performanceMonitor);

  // Protected routes (all profile routes require authentication)
  router.use(authenticateToken);

  // Primary profile routes
  router.get("/me", profileController.getOrCreatePrimaryProfile);
  router.get("/me/all", profileController.getUserProfiles);
  router.get("/me/:profileType", profileController.getProfileByType);
  router.put("/me", profileController.updatePrimaryProfile);

  // Profile management
  router.post("/", profileController.createProfile);
  router.put("/:profileId", profileController.updateProfile);
  router.delete("/:profileId", profileController.deleteProfile);

  // Agency-specific routes
  router.get("/me/agency-memberships", profileController.getAgencyMemberships);
  router.post("/:profileId/members", profileController.addAgencyMember);
  router.delete("/:profileId/members/:memberOxyUserId", profileController.removeAgencyMember);

  // Trust score routes
  router.patch("/:profileId/trust-score", profileController.updateTrustScore);
  router.patch("/me/trust-score", profileController.updatePrimaryTrustScore);
  router.post("/me/trust-score/recalculate", profileController.recalculatePrimaryTrustScore);
  router.get("/me/trust-score", profileController.getTrustScore);

  return router;
}; 