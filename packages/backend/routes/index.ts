/**
 * Routes Index
 * Central route configuration
 */

import express from 'express';
import properties from './properties';
import rooms from './rooms';
import leases from './leases';
import notifications from './notifications';
import analytics from './analytics';
import profiles from './profiles';
import ai from './ai';
import roommates from './roommates';
import viewings from './viewings';
import telegram from './telegram';
import images from './images';
import { asyncHandler } from '../middlewares';
import billing from './billing';
import scraper from './scraper';
import reviews from './reviews';
import addresses from './addresses';
import reservations from './reservations';
import applications from './applications';
import exchanges from './exchanges';
import partners from './partners';
import evictions from './evictions';
import reservationController from '../controllers/reservationController';
import cityController from '../controllers/cityController';

export default function() {
  const propertyRoutes = properties();
  const roomRoutes = rooms();
  const leaseRoutes = leases();
  const notificationRoutes = notifications();
  const analyticsRoutes = analytics();
  const profileRoutes = profiles();
  const aiRoutes = ai();
  const roommateRoutes = roommates();
  const viewingRoutes = viewings();
  const telegramRoutes = telegram();
  const imageRoutes = images;
  const billingRoutes = billing();
  const scraperRoutes = scraper();
  const reviewRoutes = reviews();
  const addressRoutes = addresses;
  const reservationRoutes = reservations();
  const applicationRoutes = applications();
  const exchangeRoutes = exchanges();
  const partnerRoutes = partners();
  const evictionRoutes = evictions();

  const router = express.Router();

  // Property availability (auth still required since mounted under oxy.auth() in server.ts).
  // Returns host availability windows + booked ranges (vacation flow).
  router.get(
    '/properties/:id/availability',
    asyncHandler(reservationController.getPropertyAvailability)
  );

  // Protected routes (authentication handled globally in server.ts)
  router.use('/properties', propertyRoutes);
  router.use('/viewings', viewingRoutes);
  router.use('/reservations', reservationRoutes);
  router.use('/applications', applicationRoutes);
  router.use('/exchanges', exchangeRoutes);
  router.use('/partners', partnerRoutes);
  router.use('/evictions', evictionRoutes);
  router.use('/rooms', roomRoutes);
  router.use('/leases', leaseRoutes);
  router.use('/notifications', notificationRoutes);
  router.use('/analytics', analyticsRoutes);
  router.use('/profiles', profileRoutes);
  router.use('/ai', aiRoutes);
  router.use('/roommates', roommateRoutes);
  router.use('/telegram', telegramRoutes);
  router.use('/images', imageRoutes);
  router.use('/billing', billingRoutes);
  router.use('/scraper', scraperRoutes);
  router.use('/reviews', reviewRoutes);
  router.use('/addresses', addressRoutes);

  // Admin-only city routes (authenticated)
  router.post('/cities', asyncHandler(cityController.createCity));
  router.put('/cities/:id/update-count', asyncHandler(cityController.updateCityPropertiesCount));

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
