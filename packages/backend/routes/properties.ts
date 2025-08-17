const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/propertyController');
const validation = require('../middlewares/validation');
const { asyncHandler } = require('../middlewares/errorHandler');

// Property routes
router.get("/", asyncHandler(propertyController.getProperties));
router.get("/search", asyncHandler(propertyController.searchProperties));
router.get("/nearby", asyncHandler(propertyController.findNearbyProperties));
router.get("/radius", asyncHandler(propertyController.findPropertiesInRadius));
router.get("/bounds", asyncHandler(propertyController.findPropertiesInBounds));

// Property creation
router.post("/", validation.validateProperty, asyncHandler(propertyController.createProperty));
router.post("/dev", validation.validateProperty, asyncHandler(propertyController.createPropertyDev));

// Property management
router.post("/test-telegram", validation.validateProperty, asyncHandler(propertyController.createPropertyDev));
router.put("/:propertyId", validation.validateProperty, asyncHandler(propertyController.updateProperty));
router.delete("/:propertyId", asyncHandler(propertyController.deleteProperty));

// Property tracking
router.post("/:propertyId/track-view", asyncHandler(profileController.trackPropertyView));

// Property energy monitoring
router.get("/:propertyId/energy", asyncHandler(propertyController.getPropertyEnergyData));
router.post("/:propertyId/energy/configure", asyncHandler(propertyController.configureEnergyMonitoring));

// Property stats
router.get("/:propertyId/stats", asyncHandler(propertyController.getPropertyStats));
router.get("/:propertyId", asyncHandler(propertyController.getPropertyById));

// User properties
router.get("/me/list", asyncHandler(propertyController.getMyProperties));

// Owner properties
router.get("/owner/:profileId", asyncHandler(propertyController.getPropertiesByOwner));

module.exports = router;