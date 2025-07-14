/**
 * Device Routes
 * API routes for IoT device management
 */

const express = require('express');
const deviceController = require('../controllers/deviceController');
const { asyncHandler } = require('../middlewares');

module.exports = function() {
  const router = express.Router();

  // Device CRUD operations
  router.get('/', asyncHandler(deviceController.getDevices));
  router.post('/', asyncHandler(deviceController.createDevice));
  router.get('/:deviceId', asyncHandler(deviceController.getDeviceById));
  router.put('/:deviceId', asyncHandler(deviceController.updateDevice));
  router.delete('/:deviceId', asyncHandler(deviceController.deleteDevice));

  // Device data and monitoring
  router.get('/:deviceId/data', asyncHandler(deviceController.getDeviceData));
  router.post('/:deviceId/data', asyncHandler(deviceController.submitDeviceData));

  // Device configuration
  router.get('/:deviceId/config', asyncHandler(deviceController.getDeviceConfig));
  router.put('/:deviceId/config', asyncHandler(deviceController.updateDeviceConfig));

  // Device status and health
  router.get('/:deviceId/status', asyncHandler(deviceController.getDeviceStatus));
  router.post('/:deviceId/ping', asyncHandler(deviceController.pingDevice));

  return router;
};