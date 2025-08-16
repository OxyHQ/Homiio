/**
 * Property Routes
 * API routes for property management
 */

import express from "express";
import { validation, asyncHandler } from "../middlewares";
import performanceMonitor from "../middlewares/performance";

export default function () {
  const router = express.Router();

  const propertyController = require("../controllers/propertyController");
  const profileController = require("../controllers/profileController");
  const viewingController = require("../controllers/viewingController");

  // Performance monitoring for all property routes
  router.use(performanceMonitor);

  // Public read routes (ordering matters: specific routes before parameterized ones)
  router.get("/", asyncHandler(propertyController.getProperties));
  router.get("/search", asyncHandler(propertyController.searchProperties));
  router.get("/nearby", asyncHandler(propertyController.findNearbyProperties));
  router.get("/radius", asyncHandler(propertyController.findPropertiesInRadius));

  // Protected routes (authentication required)
  router.post("/", validation.validateProperty, asyncHandler(propertyController.createProperty));
  router.post("/dev", validation.validateProperty, asyncHandler(propertyController.createPropertyDev));
  
  // Test route for Telegram notification (no auth required)
  router.post("/test-telegram", validation.validateProperty, asyncHandler(propertyController.createPropertyDev));
  router.put("/:propertyId", validation.validateProperty, asyncHandler(propertyController.updateProperty));
  router.delete("/:propertyId", asyncHandler(propertyController.deleteProperty));

  // Property view tracking (authenticated) - uses profileController
  router.post("/:propertyId/track-view", asyncHandler(profileController.trackPropertyView));

  // Viewing requests
  router.post(
    "/:propertyId/viewings",
    validation.validateViewingRequest,
    asyncHandler(viewingController.createViewingRequest)
  );
  router.get(
    "/:propertyId/viewings",
    asyncHandler(viewingController.listPropertyViewingRequests)
  );

  // Property-specific authenticated routes
  router.get("/:propertyId/energy", asyncHandler(propertyController.getPropertyEnergyData));
  router.post("/:propertyId/energy/configure", asyncHandler(propertyController.configureEnergyMonitoring));

  // Public property details and stats
  router.get("/:propertyId/stats", asyncHandler(propertyController.getPropertyStats));
  router.get("/:propertyId", asyncHandler(propertyController.getPropertyById));

  // User's properties (requires authentication)
  router.get("/me/list", asyncHandler(propertyController.getMyProperties));
  
  // Get properties by owner profile ID
  router.get("/owner/:profileId", asyncHandler(propertyController.getPropertiesByOwner));

  return router;
};
