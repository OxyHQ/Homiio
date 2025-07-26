/**
 * Routes Index
 * Central route configuration
 */

import express from 'express';
const properties = require('./properties');
const rooms = require('./rooms');
const devices = require('./devices');
const leases = require('./leases');
const notifications = require('./notifications');
const analytics = require('./analytics');
const profiles = require('./profiles');
const ai = require('./ai');
const roommates = require('./roommates');
const telegram = require('./telegram');
const { asyncHandler } = require('../middlewares');

export default function() {
  const propertyRoutes = properties();
  const roomRoutes = rooms();
  const deviceRoutes = devices();
  const leaseRoutes = leases();
  const notificationRoutes = notifications();
  const analyticsRoutes = analytics();
  const profileRoutes = profiles();
  const aiRoutes = ai();
  const roommateRoutes = roommates();
  const telegramRoutes = telegram();

  const router = express.Router();

  // Protected routes (authentication handled globally in server.ts)
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

  // Admin-only city routes (authenticated)
  router.post('/cities', asyncHandler(require('../controllers/cityController').default.createCity));
  router.put('/cities/:id/update-count', asyncHandler(require('../controllers/cityController').default.updateCityPropertiesCount));

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
