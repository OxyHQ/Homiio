/**
 * Routes Index
 * Central route configuration
 */

const express = require('express');
const propertyRoutes = require('./properties');
const roomRoutes = require('./rooms');

const router = express.Router();

// Mount route modules
router.use('/properties', propertyRoutes);
router.use('/properties/:propertyId/rooms', roomRoutes);

// Health check route
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Homio API',
    version: '1.0.0'
  });
});

module.exports = router;
