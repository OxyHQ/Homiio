/**
 * Device Controller
 * Handles IoT device management operations
 */

const { energyService } = require('../services');
const { successResponse, paginationResponse, AppError } = require('../middlewares/errorHandler');
const { logger } = require('../middlewares/logging');

class DeviceController {
  /**
   * Get user's devices
   */
  async getDevices(req, res, next) {
    try {
      const userId = req.userId;
      const {
        page = 1,
        limit = 10,
        propertyId,
        type,
        status,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // In a real implementation, fetch devices from database
      // const devices = await DeviceModel.findByUserId(userId, filters);

      const mockDevices = [
        {
          id: 'device_1',
          name: 'Living Room Energy Monitor',
          serialNumber: 'ESP32-001',
          macAddress: '12:34:56:78:9A:BC',
          type: 'smart-meter',
          propertyId: 'prop_1',
          roomId: 'room_1',
          status: 'online',
          configuration: {
            samplingRate: 60,
            alertThresholds: {
              maxPower: 5000,
              maxCurrent: 20
            }
          },
          lastSeen: new Date().toISOString(),
          firmwareVersion: '1.2.3',
          createdAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 'device_2',
          name: 'Kitchen Smart Sensor',
          serialNumber: 'RPI-002',
          macAddress: '12:34:56:78:9A:BD',
          type: 'raspberry-pi',
          propertyId: 'prop_1',
          roomId: 'room_2',
          status: 'offline',
          configuration: {
            samplingRate: 30,
            sensors: ['temperature', 'humidity', 'light']
          },
          lastSeen: '2024-01-15T10:30:00Z',
          firmwareVersion: '2.1.0',
          createdAt: '2024-01-01T00:00:00Z'
        }
      ];

      // Apply filters
      let filteredDevices = mockDevices;
      if (propertyId) {
        filteredDevices = filteredDevices.filter(d => d.propertyId === propertyId);
      }
      if (type) {
        filteredDevices = filteredDevices.filter(d => d.type === type);
      }
      if (status) {
        filteredDevices = filteredDevices.filter(d => d.status === status);
      }

      const total = filteredDevices.length;

      res.json(paginationResponse(
        filteredDevices,
        parseInt(page),
        parseInt(limit),
        total,
        'Devices retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new device
   */
  async createDevice(req, res, next) {
    try {
      const deviceData = {
        ...req.body,
        ownerId: req.userId,
        status: 'offline',
        createdAt: new Date(),
        lastSeen: null
      };

      // In a real implementation, save to database and register with IoT platform
      // const device = await DeviceModel.create(deviceData);
      // await IoTPlatform.registerDevice(device);

      const newDevice = {
        id: `device_${Date.now()}`,
        ...deviceData,
        apiKey: `api_${Math.random().toString(36).substr(2, 9)}` // Generate API key
      };

      logger.info('Device created', {
        deviceId: newDevice.id,
        ownerId: req.userId,
        propertyId: deviceData.propertyId
      });

      res.status(201).json(successResponse(
        newDevice,
        'Device created successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get device by ID
   */
  async getDeviceById(req, res, next) {
    try {
      const { deviceId } = req.params;

      // In a real implementation, fetch from database
      // const device = await DeviceModel.findById(deviceId);

      const mockDevice = {
        id: deviceId,
        name: 'Living Room Energy Monitor',
        serialNumber: 'ESP32-001',
        macAddress: '12:34:56:78:9A:BC',
        type: 'smart-meter',
        propertyId: 'prop_1',
        roomId: 'room_1',
        ownerId: req.userId,
        status: 'online',
        configuration: {
          samplingRate: 60,
          alertThresholds: {
            maxPower: 5000,
            maxCurrent: 20,
            maxVoltage: 250
          },
          calibration: {
            voltageMultiplier: 1.0,
            currentMultiplier: 1.0
          }
        },
        capabilities: ['energy_monitoring', 'real_time_data', 'alerts'],
        lastSeen: new Date().toISOString(),
        firmwareVersion: '1.2.3',
        hardwareVersion: '2.0',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: new Date().toISOString()
      };

      res.json(successResponse(mockDevice, 'Device retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update device
   */
  async updateDevice(req, res, next) {
    try {
      const { deviceId } = req.params;
      const updateData = req.body;

      // In a real implementation, update in database
      // const updatedDevice = await DeviceModel.findByIdAndUpdate(deviceId, updateData);

      const updatedDevice = {
        id: deviceId,
        ...updateData,
        updatedAt: new Date().toISOString()
      };

      logger.info('Device updated', { deviceId, ownerId: req.userId });

      res.json(successResponse(updatedDevice, 'Device updated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete device
   */
  async deleteDevice(req, res, next) {
    try {
      const { deviceId } = req.params;

      // In a real implementation, soft delete and cleanup
      // await DeviceModel.softDelete(deviceId);
      // await IoTPlatform.unregisterDevice(deviceId);

      logger.info('Device deleted', { deviceId, ownerId: req.userId });

      res.json(successResponse(null, 'Device deleted successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get device data/readings
   */
  async getDeviceData(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { 
        startDate, 
        endDate, 
        period = 'hour',
        metric = 'all'
      } = req.query;

      // Use energy service to get device data
      const deviceData = await energyService.getEnergyStats(deviceId, period);

      res.json(successResponse(deviceData, 'Device data retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Submit device data (from device)
   */
  async submitDeviceData(req, res, next) {
    try {
      const { deviceId } = req.params;
      const dataPoints = req.body;

      // In a real implementation, validate and store data
      // await DeviceDataModel.create({
      //   deviceId,
      //   ...dataPoints,
      //   timestamp: new Date()
      // });

      // Process data through energy service
      await energyService.processDeviceData(deviceId, dataPoints);

      logger.info('Device data submitted', { 
        deviceId,
        dataPointsCount: Array.isArray(dataPoints) ? dataPoints.length : 1
      });

      res.json(successResponse(null, 'Data submitted successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get device configuration
   */
  async getDeviceConfig(req, res, next) {
    try {
      const { deviceId } = req.params;

      // In a real implementation, fetch from database
      const mockConfig = {
        deviceId,
        samplingRate: 60,
        alertThresholds: {
          maxPower: 5000,
          maxCurrent: 20,
          maxVoltage: 250,
          minVoltage: 200
        },
        calibration: {
          voltageMultiplier: 1.0,
          currentMultiplier: 1.0,
          powerFactor: 0.95
        },
        network: {
          wifi: {
            ssid: 'HomeNetwork',
            autoReconnect: true
          },
          mqtt: {
            broker: 'mqtt.homio.local',
            port: 1883,
            keepAlive: 60
          }
        },
        features: {
          realTimeMonitoring: true,
          alertsEnabled: true,
          dataLogging: true,
          remoteControl: false
        }
      };

      res.json(successResponse(mockConfig, 'Device configuration retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update device configuration
   */
  async updateDeviceConfig(req, res, next) {
    try {
      const { deviceId } = req.params;
      const configUpdate = req.body;

      // In a real implementation, update configuration and push to device
      // await DeviceModel.updateConfiguration(deviceId, configUpdate);
      // await IoTPlatform.pushConfiguration(deviceId, configUpdate);

      logger.info('Device configuration updated', { deviceId });

      res.json(successResponse(null, 'Device configuration updated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get device status
   */
  async getDeviceStatus(req, res, next) {
    try {
      const { deviceId } = req.params;

      // In a real implementation, check device connectivity and health
      const mockStatus = {
        deviceId,
        status: 'online',
        lastSeen: new Date().toISOString(),
        uptime: 86400, // seconds
        connectivity: {
          signal: 'strong',
          ip: '192.168.1.100',
          gateway: '192.168.1.1'
        },
        health: {
          cpu: 15, // percentage
          memory: 45, // percentage
          temperature: 35, // celsius
          batteryLevel: null // not battery powered
        },
        firmware: {
          current: '1.2.3',
          latest: '1.2.4',
          updateAvailable: true
        },
        diagnostics: {
          lastHeartbeat: new Date().toISOString(),
          errorCount: 0,
          warnings: []
        }
      };

      res.json(successResponse(mockStatus, 'Device status retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Ping device (from device)
   */
  async pingDevice(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { status, metrics } = req.body;

      // In a real implementation, update device last seen and status
      // await DeviceModel.updateLastSeen(deviceId, new Date());
      // if (metrics) {
      //   await DeviceMetricsModel.create({ deviceId, ...metrics });
      // }

      logger.debug('Device ping received', { deviceId });

      res.json(successResponse(null, 'Ping received'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DeviceController();