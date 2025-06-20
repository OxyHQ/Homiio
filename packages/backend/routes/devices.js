/**
 * Device Routes
 * API routes for IoT device management
 */

const express = require('express');
const { deviceController } = require('../controllers');
const { validation } = require('../middlewares');

module.exports = function(authenticateToken) {
  const router = express.Router();

  // Protected routes (authentication required)
  router.use(authenticateToken);

  // Device CRUD operations
  router.get('/', deviceController.getDevices);
  router.post('/', validation.validateDevice, deviceController.createDevice);
  router.get('/:deviceId', 
    validation.validateId('deviceId'),
    deviceController.getDeviceById
  );
  router.put('/:deviceId', 
    validation.validateId('deviceId'),
    validation.validateDevice,
    deviceController.updateDevice
  );
  router.delete('/:deviceId', 
    validation.validateId('deviceId'),
    deviceController.deleteDevice
  );

  // Device data and monitoring
  router.get('/:deviceId/data', 
    validation.validateId('deviceId'),
    validation.validateDateRange,
    deviceController.getDeviceData
  );
  router.post('/:deviceId/data', 
    validation.validateId('deviceId'),
    validation.validateEnergyData,
    deviceController.submitDeviceData
  );

  // Device configuration
  router.get('/:deviceId/config', 
    validation.validateId('deviceId'),
    deviceController.getDeviceConfig
  );
  router.put('/:deviceId/config', 
    validation.validateId('deviceId'),
    deviceController.updateDeviceConfig
  );

  // Device status and health
  router.get('/:deviceId/status', 
    validation.validateId('deviceId'),
    deviceController.getDeviceStatus
  );
  router.post('/:deviceId/ping', 
    validation.validateId('deviceId'),
    deviceController.pingDevice
  );

  return router;
};