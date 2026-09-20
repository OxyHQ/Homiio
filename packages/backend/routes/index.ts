/**
 * Routes Index
 * Central route configuration
 */

import express from 'express';
import properties from './properties';
import rooms from './rooms';
import leases from './leases';
import maintenance from './maintenance';
import notifications from './notifications';
import analytics from './analytics';
import profiles from './profiles';
import ai from './ai';
import roommates from './roommates';
import viewings from './viewings';
import telegram from './telegram';
import images from './images';
import { asyncHandler } from '../middlewares';
import { serializeWireIds } from '../middlewares/wireIds';
import billing from './billing';
import scraper from './scraper';
import reviews from './reviews';
import addresses from './addresses';
import reservations from './reservations';
import applications from './applications';
import exchanges from './exchanges';
import guestPoints from './guestPoints';
import partners from './partners';
import evictions from './evictions';
import cityController from '../controllers/cityController';

export default function() {
  const propertyRoutes = properties();
  const roomRoutes = rooms();
  const leaseRoutes = leases();
  const maintenanceRoutes = maintenance();
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
  const guestPointRoutes = guestPoints();
  const partnerRoutes = partners();
  const evictionRoutes = evictions();

  const router = express.Router();

  // FIRST, so every body below leaves as `id` and never `_id`. See wireIds.ts:
  // `.lean()` reads never pass through a schema `toJSON`, so a per-model
  // transform cannot cover this router.
  router.use(serializeWireIds);

  // `GET /properties/:id/availability` is NOT here any more: it moved to
  // `routes/public.ts`. A signed-out visitor was shown a calendar with no
  // blocked days at all, which is the most confident wrong answer a booking
  // surface can give. What made the move safe is the projection — dates and a
  // status, nothing else — not a check inside the handler.

  // Protected routes (authentication handled globally in server.ts)
  router.use('/properties', propertyRoutes);
  router.use('/viewings', viewingRoutes);
  router.use('/reservations', reservationRoutes);
  router.use('/applications', applicationRoutes);
  router.use('/exchanges', exchangeRoutes);
  router.use('/guest-points', guestPointRoutes);
  router.use('/partners', partnerRoutes);
  router.use('/evictions', evictionRoutes);
  router.use('/rooms', roomRoutes);
  router.use('/leases', leaseRoutes);
  router.use('/maintenance', maintenanceRoutes);
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
