/**
 * Device Routes
 * API routes for IoT device management
 */

const express = require('express');
const { deviceController } = require('../controllers');
const { validation, asyncHandler } = require('../middlewares');

module.exports = function(authenticateToken) {
  const router = express.Router();

  // Protected routes (authentication required)
  router.use(authenticateToken);

  // Device CRUD operations
  router.get('/', asyncHandler(deviceController.getDevices));
  router.post('/', validation.validateDevice, asyncHandler(deviceController.createDevice));
  router.get('/:deviceId', 
    validation.validateId('deviceId'),
    asyncHandler(deviceController.getDeviceById)
  );
  router.put('/:deviceId', 
    validation.validateId('deviceId'),
    validation.validateDevice,
    asyncHandler(deviceController.updateDevice)
  );
  router.delete('/:deviceId', 
    validation.validateId('deviceId'),
    asyncHandler(deviceController.deleteDevice)
  );

  // Device data and monitoring
  router.get('/:deviceId/data', 
    validation.validateId('deviceId'),
    validation.validateDateRange,
    asyncHandler(deviceController.getDeviceData)
  );
  router.post('/:deviceId/data', 
    validation.validateId('deviceId'),
    validation.validateEnergyData,
    asyncHandler(deviceController.submitDeviceData)
  );

  // Device configuration
  router.get('/:deviceId/config', 
    validation.validateId('deviceId'),
    asyncHandler(deviceController.getDeviceConfig)
  );
  router.put('/:deviceId/config', 
    validation.validateId('deviceId'),
    asyncHandler(deviceController.updateDeviceConfig)
  );

  // Device status and health
  router.get('/:deviceId/status', 
    validation.validateId('deviceId'),
    asyncHandler(deviceController.getDeviceStatus)
  );
  router.post('/:deviceId/ping', 
    validation.validateId('deviceId'),
    asyncHandler(deviceController.pingDevice)
  );

  return router;
};