const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/propertyController');
const profileController = require('../controllers/profileController');
const validation = require('../middlewares/validation');
const { asyncHandler } = require('../middlewares/errorHandler');

// Property creation (requires authentication)
router.post("/", validation.validateProperty, asyncHandler(propertyController.createProperty));
router.post("/dev", validation.validateProperty, asyncHandler(propertyController.createPropertyDev));

// Property management (requires authentication)
router.post("/test-telegram", validation.validateProperty, asyncHandler(propertyController.createPropertyDev));
router.put("/:propertyId", validation.validateProperty, asyncHandler(propertyController.updateProperty));
router.delete("/:propertyId", asyncHandler(propertyController.deleteProperty));

// Property tracking (requires authentication)
router.post("/:propertyId/track-view", asyncHandler(profileController.trackPropertyView));

// Property energy monitoring (requires authentication)
router.get("/:propertyId/energy", asyncHandler(propertyController.getPropertyEnergyData));
router.post("/:propertyId/energy/configure", asyncHandler(propertyController.configureEnergyMonitoring));

// User properties (requires authentication)
router.get("/me/list", asyncHandler(propertyController.getMyProperties));

// Owner properties (requires authentication)
router.get("/owner/:profileId", asyncHandler(propertyController.getPropertiesByOwner));

export default function() {
  return router;
};