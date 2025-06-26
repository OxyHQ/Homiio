/**
 * Property Routes
 * API routes for property management
 */

const express = require("express");
const propertyController = require("../controllers/propertyController");
const profileController = require("../controllers/profileController");
const { validation, asyncHandler } = require("../middlewares");
const performanceMonitor = require("../middlewares/performance");

module.exports = function () {
  const router = express.Router();

  // Performance monitoring for all property routes
  router.use(performanceMonitor);

  // Protected routes (authentication required)
  router.post("/", validation.validateProperty, asyncHandler(propertyController.createProperty));
  router.post("/dev", validation.validateProperty, asyncHandler(propertyController.createPropertyDev));
  router.put("/:propertyId", validation.validateProperty, asyncHandler(propertyController.updateProperty));
  router.delete("/:propertyId", asyncHandler(propertyController.deleteProperty));

  // Property view tracking (authenticated) - uses profileController
  router.post("/:propertyId/track-view", asyncHandler(profileController.trackPropertyView));

  // Property-specific authenticated routes
  router.get("/:propertyId/energy", asyncHandler(propertyController.getPropertyEnergyData));
  router.post("/:propertyId/energy/configure", asyncHandler(propertyController.configureEnergyMonitoring));

  // User's properties (requires authentication)
  router.get("/me/list", asyncHandler(propertyController.getMyProperties));

  return router;
};
