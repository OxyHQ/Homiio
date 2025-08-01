/**
 * Routes Index
 * Central route configuration
 */

import express from 'express';
const properties = require('./properties').default;
const rooms = require('./rooms');
const devices = require('./devices').default;
const leases = require('./leases');
const notifications = require('./notifications');
const analytics = require('./analytics');
const profiles = require('./profiles').default;
const ai = require('./ai').default;
const roommates = require('./roommates').default;
const telegram = require('./telegram');
const tips = require('./tips').default;
const test = require('./test').default;
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
  const tipsRoutes = tips();
  const testRoutes = test();

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
  router.use('/tips', tipsRoutes);
  router.use('/test', testRoutes);

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
