/**
 * Property Routes
 * API routes for property management
 */

const express = require('express');
const { propertyController } = require('../controllers');
const { validation } = require('../middlewares');

module.exports = function(authenticateToken) {
  const router = express.Router();

  // Optional authentication middleware for public routes that can benefit from auth
  const optionalAuth = (req, res, next) => {
    // Try to authenticate, but don't fail if no token provided
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // If token is provided, try to authenticate
      authenticateToken(req, res, (err) => {
        // Continue even if authentication fails
        next();
      });
    } else {
      // No token provided, continue as guest
      next();
    }
  };

  // Public routes (no authentication required)
  router.get('/', propertyController.getProperties);
  router.get('/search', propertyController.searchProperties);
  
  // Property viewing with optional authentication (for recently viewed tracking)
  router.get('/:propertyId', 
    validation.validateId('propertyId'), 
    optionalAuth,
    propertyController.getPropertyById
  );

  // Property CRUD operations (require authentication)
  router.post('/', authenticateToken, validation.validateProperty, propertyController.createProperty);

  // Development/testing route without authentication (remove in production)
  router.post('/dev', validation.validateProperty, propertyController.createPropertyDev);

  router.put('/:propertyId', 
    authenticateToken,
    validation.validateId('propertyId'),
    validation.validateProperty,
    propertyController.updateProperty
  );
  router.delete('/:propertyId', 
    authenticateToken,
    validation.validateId('propertyId'),
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
    propertyController.configureEnergyMonitoring
  );

  router.get('/:propertyId/stats',
    validation.validateId('propertyId'),
    propertyController.getPropertyStats
  );

  return router;
};
