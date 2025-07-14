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
