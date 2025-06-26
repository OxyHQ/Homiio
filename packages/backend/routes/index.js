/**
 * Routes Index
 * Central route configuration
 */

const express = require('express');

module.exports = function() {
  const propertyRoutes = require('./properties')();
  const roomRoutes = require('./rooms')();
  const deviceRoutes = require('./devices')();
  const leaseRoutes = require('./leases')();
  const notificationRoutes = require('./notifications')();
  const analyticsRoutes = require('./analytics')();
  const profileRoutes = require('./profiles')();
  const aiRoutes = require('./ai')();
  const roommateRoutes = require('./roommates')();
  const telegramRoutes = require('./telegram')();

  const router = express.Router();

  // Protected routes (authentication handled globally in server.js)
  router.use('/properties', propertyRoutes);
  router.use('/rooms', roomRoutes);
  router.use('/devices', deviceRoutes);
  router.use('/leases', leaseRoutes);
  router.use('/notifications', notificationRoutes);
  router.use('/analytics', analyticsRoutes);
  router.use('/profiles', profileRoutes);
  router.use('/ai', aiRoutes);
  router.use('/roommates', roommateRoutes);
  router.use('/telegram', telegramRoutes);

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
