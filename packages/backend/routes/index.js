/**
 * Routes Index
 * Central route configuration
 */

const express = require('express');

module.exports = function(authenticateToken) {
  const userRoutes = require('./users')(authenticateToken);
  const propertyRoutes = require('./properties')(authenticateToken);
  const roomRoutes = require('./rooms');
  const deviceRoutes = require('./devices')(authenticateToken);
  const leaseRoutes = require('./leases')(authenticateToken);
  const notificationRoutes = require('./notifications')(authenticateToken);
  const analyticsRoutes = require('./analytics');

  const router = express.Router();

  // Mount route modules
  router.use('/users', userRoutes);
  router.use('/properties', propertyRoutes);
  router.use('/properties/:propertyId/rooms', roomRoutes);
  router.use('/devices', deviceRoutes);
  router.use('/leases', leaseRoutes);
  router.use('/notifications', notificationRoutes);
  router.use('/analytics', analyticsRoutes);

  // Health check route
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Homio API',
      version: '1.0.0'
    });
  });

  return router;
};
