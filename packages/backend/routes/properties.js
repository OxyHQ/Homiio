/**
 * Property Routes
 * API routes for property management
 */

const express = require('express');
const { propertyController } = require('../controllers');
const { validation, asyncHandler } = require('../middlewares');

module.exports = function(authenticateToken) {
  const router = express.Router();

  // Public routes (no authentication required)
  router.get('/', asyncHandler(propertyController.getProperties));
  router.get('/search', asyncHandler(propertyController.searchProperties));
  
  // Property viewing with authentication (for recently viewed tracking)
  router.get('/:propertyId', 
    validation.validateId('propertyId'), 
    authenticateToken,
    asyncHandler(propertyController.getPropertyById)
  );

  // Property CRUD operations (require authentication)
  router.post('/', authenticateToken, validation.validateProperty, asyncHandler(propertyController.createProperty));

  // Development/testing route without authentication (remove in production)
  router.post('/dev', validation.validateProperty, asyncHandler(propertyController.createPropertyDev));

  router.put('/:propertyId', 
    authenticateToken,
    validation.validateId('propertyId'),
    validation.validateProperty,
    asyncHandler(propertyController.updateProperty)
  );
  router.delete('/:propertyId', 
    authenticateToken,
    validation.validateId('propertyId'),
    asyncHandler(propertyController.deleteProperty)
  );

  // User's properties
  router.get('/my/properties', authenticateToken, asyncHandler(propertyController.getMyProperties));

  // Energy monitoring
  router.get('/:propertyId/energy', 
    validation.validateId('propertyId'),
    validation.validateDateRange,
    asyncHandler(propertyController.getPropertyEnergyData)
  );
  router.post('/:propertyId/energy/configure',
    validation.validateId('propertyId'),
    asyncHandler(propertyController.configureEnergyMonitoring)
  );

  router.get('/:propertyId/stats',
    validation.validateId('propertyId'),
    asyncHandler(propertyController.getPropertyStats)
  );

  return router;
};
