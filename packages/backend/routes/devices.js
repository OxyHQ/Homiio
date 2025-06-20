/**
 * Device Routes
 * API routes for IoT device management
 */

const express = require('express');
const { deviceController } = require('../controllers');
const { auth, validation } = require('../middlewares');

const router = express.Router();

// Protected routes (authentication required)
router.use(auth.verifyToken);

// Device CRUD operations
router.get('/', deviceController.getDevices);
router.post('/', validation.validateDevice, deviceController.createDevice);
router.get('/:deviceId', 
  validation.validateId('deviceId'),
  auth.verifyDeviceAccess,
  deviceController.getDeviceById
);
router.put('/:deviceId', 
  validation.validateId('deviceId'),
  auth.verifyDeviceAccess,
  validation.validateDevice,
  deviceController.updateDevice
);
router.delete('/:deviceId', 
  validation.validateId('deviceId'),
  auth.verifyDeviceAccess,
  deviceController.deleteDevice
);

// Device data and monitoring
router.get('/:deviceId/data', 
  validation.validateId('deviceId'),
  auth.verifyDeviceAccess,
  validation.validateDateRange,
  deviceController.getDeviceData
);
router.post('/:deviceId/data', 
  validation.validateId('deviceId'),
  auth.verifyDeviceApiKey,
  validation.validateEnergyData,
  deviceController.submitDeviceData
);

// Device configuration
router.get('/:deviceId/config', 
  validation.validateId('deviceId'),
  auth.verifyDeviceAccess,
  deviceController.getDeviceConfig
);
router.put('/:deviceId/config', 
  validation.validateId('deviceId'),
  auth.verifyDeviceAccess,
  deviceController.updateDeviceConfig
);

// Device status and health
router.get('/:deviceId/status', 
  validation.validateId('deviceId'),
  auth.verifyDeviceAccess,
  deviceController.getDeviceStatus
);
router.post('/:deviceId/ping', 
  validation.validateId('deviceId'),
  auth.verifyDeviceApiKey,
  deviceController.pingDevice
);

module.exports = router;