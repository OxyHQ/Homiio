/**
 * Routes Index
 * Central route configuration
 */

import express from 'express';
import properties from './properties';
import rooms from './rooms';
import devices from './devices';
import leases from './leases';
import notifications from './notifications';
import analytics from './analytics';
import profiles from './profiles';
import ai from './ai';
import roommates from './roommates';
import telegram from './telegram';

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
