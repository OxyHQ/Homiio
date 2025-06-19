/**
 * Property Routes
 * API routes for property management
 */

const express = require('express');
const { propertyController } = require('../controllers');
const { auth, validation } = require('../middlewares');

const router = express.Router();

// Public routes (no authentication required)
router.get('/', propertyController.getProperties);
router.get('/:propertyId', validation.validateId('propertyId'), propertyController.getPropertyById);

// Protected routes (authentication required)
router.use(auth.verifyToken);

// Property CRUD operations
router.post('/', validation.validateProperty, propertyController.createProperty);
router.put('/:propertyId', 
  validation.validateId('propertyId'),
  auth.verifyPropertyOwnership,
  validation.validateProperty,
  propertyController.updateProperty
);
router.delete('/:propertyId', 
  validation.validateId('propertyId'),
  auth.verifyPropertyOwnership,
  propertyController.deleteProperty
);

// User's properties
router.get('/my/properties', propertyController.getMyProperties);

// Energy monitoring
router.get('/:propertyId/energy', 
  validation.validateId('propertyId'),
  validation.validateDateRange,
  propertyController.getPropertyEnergyData
);
router.post('/:propertyId/energy/configure',
  validation.validateId('propertyId'),
  auth.verifyPropertyOwnership,
  propertyController.configureEnergyMonitoring
);

module.exports = router;
