/**
 * Energy Monitoring Service
 * Handles energy data from Raspberry Pi devices
 */

const mqtt = require('mqtt');
const axios = require('axios');
const config = require('../config');
const { logger, businessLogger } = require('../middlewares/logging');
const { AppError } = require('../middlewares/errorHandler');

class EnergyService {
  constructor() {
    this.mqttClient = null;
    this.connectToMQTT();
  }

  /**
   * Connect to MQTT broker for real-time device communication
   */
  connectToMQTT() {
    try {
      this.mqttClient = mqtt.connect(config.raspberryPi.mqttBroker);

      this.mqttClient.on('connect', () => {
        logger.info('Connected to MQTT broker');
        this.subscribeToDeviceTopics();
      });

      this.mqttClient.on('message', (topic, message) => {
        this.handleDeviceMessage(topic, message);
      });

      this.mqttClient.on('error', (error) => {
        logger.error('MQTT connection error', { error: error.message });
      });
    } catch (error) {
      logger.error('Failed to connect to MQTT broker', { error: error.message });
    }
  }

  /**
   * Subscribe to device data topics
   */
  subscribeToDeviceTopics() {
    const topics = [
      'devices/+/energy',
      'devices/+/status',
      'devices/+/alerts'
    ];

    topics.forEach(topic => {
      this.mqttClient.subscribe(topic, (err) => {
        if (err) {
          logger.error('Failed to subscribe to MQTT topic', { topic, error: err.message });
        } else {
          logger.info('Subscribed to MQTT topic', { topic });
        }
      });
    });
  }

  /**
   * Handle incoming device messages
   */
  async handleDeviceMessage(topic, message) {
    try {
      const data = JSON.parse(message.toString());
      const [, deviceId, messageType] = topic.split('/');

      switch (messageType) {
        case 'energy':
          await this.processEnergyData(deviceId, data);
          break;
        case 'status':
          await this.processDeviceStatus(deviceId, data);
          break;
        case 'alerts':
          await this.processDeviceAlert(deviceId, data);
          break;
        default:
          logger.warn('Unknown message type', { topic, messageType });
      }
    } catch (error) {
      logger.error('Failed to process device message', {
        topic,
        error: error.message
      });
    }
  }

  /**
   * Process energy consumption data
   */
  async processEnergyData(deviceId, data) {
    try {
      // Validate energy data
      const energyData = this.validateEnergyData(deviceId, data);
      
      // Store in database
      // await EnergyDataModel.create(energyData);
      
      // Check for anomalies
      const anomalies = this.detectEnergyAnomalies(energyData);
      if (anomalies.length > 0) {
        await this.handleEnergyAnomalies(deviceId, anomalies);
      }

      // Update real-time dashboard
      await this.updateRealTimeDashboard(deviceId, energyData);

      businessLogger.energyDataReceived(deviceId, energyData.propertyId, 1);
    } catch (error) {
      logger.error('Failed to process energy data', {
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Validate incoming energy data
   */
  validateEnergyData(deviceId, data) {
    const requiredFields = ['voltage', 'current', 'power', 'timestamp'];
    const missingFields = requiredFields.filter(field => !(field in data));
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    return {
      deviceId,
      propertyId: data.propertyId,
      timestamp: new Date(data.timestamp),
      readings: {
        voltage: parseFloat(data.voltage),
        current: parseFloat(data.current),
        power: parseFloat(data.power),
        energy: parseFloat(data.energy || 0),
        frequency: parseFloat(data.frequency || 60),
        powerFactor: parseFloat(data.powerFactor || 1)
      },
      sensors: data.sensors || [],
      metadata: data.metadata || {}
    };
  }

  /**
   * Detect energy consumption anomalies
   */
  detectEnergyAnomalies(energyData) {
    const anomalies = [];
    const { readings } = energyData;

    // Voltage anomalies
    if (readings.voltage < 110 || readings.voltage > 125) {
      anomalies.push({
        type: 'voltage',
        severity: readings.voltage < 100 || readings.voltage > 130 ? 'high' : 'medium',
        message: `Voltage out of range: ${readings.voltage}V`,
        value: readings.voltage,
        threshold: '110-125V'
      });
    }

    // High power consumption
    if (readings.power > 5000) {
      anomalies.push({
        type: 'high_power',
        severity: readings.power > 10000 ? 'high' : 'medium',
        message: `High power consumption: ${readings.power}W`,
        value: readings.power,
        threshold: '5000W'
      });
    }

    // Low power factor
    if (readings.powerFactor < 0.8) {
      anomalies.push({
        type: 'power_factor',
        severity: readings.powerFactor < 0.6 ? 'high' : 'low',
        message: `Low power factor: ${readings.powerFactor}`,
        value: readings.powerFactor,
        threshold: '0.8'
      });
    }

    // Frequency anomalies
    if (readings.frequency < 59.5 || readings.frequency > 60.5) {
      anomalies.push({
        type: 'frequency',
        severity: 'medium',
        message: `Frequency out of range: ${readings.frequency}Hz`,
        value: readings.frequency,
        threshold: '59.5-60.5Hz'
      });
    }

    return anomalies;
  }

  /**
   * Handle energy anomalies
   */
  async handleEnergyAnomalies(deviceId, anomalies) {
    logger.warn('Energy anomalies detected', {
      deviceId,
      anomalies
    });

    // Send alerts to property owner and tenants
    // await NotificationService.sendEnergyAnomalyAlert(deviceId, anomalies);

    // Store anomaly records
    // await AnomalyModel.createMany(anomalies.map(a => ({ ...a, deviceId })));
  }

  /**
   * Update real-time dashboard
   */
  async updateRealTimeDashboard(deviceId, energyData) {
    // Emit to WebSocket clients
    // SocketService.emitToRoom(`device:${deviceId}`, 'energy-update', energyData);
    
    // Update cache for quick access
    // await CacheService.setEnergyData(deviceId, energyData);
  }

  /**
   * Process device status updates
   */
  async processDeviceStatus(deviceId, statusData) {
    try {
      const status = {
        deviceId,
        online: statusData.online,
        lastSeen: new Date(),
        uptime: statusData.uptime,
        cpuUsage: statusData.cpuUsage,
        memoryUsage: statusData.memoryUsage,
        temperature: statusData.temperature,
        diskUsage: statusData.diskUsage,
        connectivity: statusData.connectivity
      };

      // Update device status in database
      // await DeviceModel.updateStatus(deviceId, status);

      // Check for device health issues
      const healthIssues = this.checkDeviceHealth(status);
      if (healthIssues.length > 0) {
        await this.handleDeviceHealthIssues(deviceId, healthIssues);
      }

      businessLogger.deviceStatusChanged(deviceId, 'unknown', statusData.online ? 'online' : 'offline');
    } catch (error) {
      logger.error('Failed to process device status', {
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Check device health
   */
  checkDeviceHealth(status) {
    const issues = [];

    if (status.cpuUsage > 80) {
      issues.push({
        type: 'high_cpu',
        severity: status.cpuUsage > 95 ? 'high' : 'medium',
        message: `High CPU usage: ${status.cpuUsage}%`
      });
    }

    if (status.memoryUsage > 80) {
      issues.push({
        type: 'high_memory',
        severity: status.memoryUsage > 95 ? 'high' : 'medium',
        message: `High memory usage: ${status.memoryUsage}%`
      });
    }

    if (status.temperature > 70) {
      issues.push({
        type: 'high_temperature',
        severity: status.temperature > 80 ? 'high' : 'medium',
        message: `High temperature: ${status.temperature}°C`
      });
    }

    if (status.diskUsage > 90) {
      issues.push({
        type: 'low_disk_space',
        severity: 'high',
        message: `Low disk space: ${status.diskUsage}% used`
      });
    }

    return issues;
  }

  /**
   * Handle device health issues
   */
  async handleDeviceHealthIssues(deviceId, issues) {
    logger.warn('Device health issues detected', {
      deviceId,
      issues
    });

    // Send maintenance alerts
    // await NotificationService.sendDeviceMaintenanceAlert(deviceId, issues);
  }

  /**
   * Process device alerts
   */
  async processDeviceAlert(deviceId, alertData) {
    try {
      const alert = {
        deviceId,
        type: alertData.type,
        severity: alertData.severity,
        message: alertData.message,
        data: alertData.data,
        timestamp: new Date(alertData.timestamp)
      };

      // Store alert in database
      // await AlertModel.create(alert);

      // Send immediate notifications for high severity alerts
      if (alert.severity === 'high') {
        // await NotificationService.sendImmediateAlert(alert);
      }

      logger.warn('Device alert received', alert);
    } catch (error) {
      logger.error('Failed to process device alert', {
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Get energy consumption statistics
   */
  async getEnergyStats(propertyId, period = 'day') {
    try {
      // This would query the database for energy statistics
      // const stats = await EnergyDataModel.getStats(propertyId, period);
      
      const mockStats = {
        totalConsumption: 125.6, // kWh
        averagePower: 2340, // W
        peakPower: 4560, // W
        cost: {
          amount: 18.84,
          currency: 'USD'
        },
        efficiency: 'B',
        carbonFootprint: 62.8, // kg CO2
        comparison: {
          previousPeriod: -5.2, // % change
          neighborhood: +12.3 // % vs average
        }
      };

      return mockStats;
    } catch (error) {
      logger.error('Failed to get energy stats', {
        propertyId,
        period,
        error: error.message
      });
      throw new AppError('Failed to get energy statistics', 500, 'DEVICE_ERROR');
    }
  }

  /**
   * Send command to device
   */
  async sendDeviceCommand(deviceId, command, parameters = {}) {
    try {
      const message = {
        command,
        parameters,
        timestamp: new Date().toISOString()
      };

      const topic = `devices/${deviceId}/commands`;
      this.mqttClient.publish(topic, JSON.stringify(message));

      logger.info('Device command sent', {
        deviceId,
        command,
        parameters
      });

      return { success: true };
    } catch (error) {
      logger.error('Failed to send device command', {
        deviceId,
        command,
        error: error.message
      });
      throw new AppError('Failed to send device command', 500, 'DEVICE_ERROR');
    }
  }

  /**
   * Configure device settings
   */
  async configureDevice(deviceId, configuration) {
    try {
      await this.sendDeviceCommand(deviceId, 'configure', configuration);
      
      // Update device configuration in database
      // await DeviceModel.updateConfiguration(deviceId, configuration);

      return { success: true };
    } catch (error) {
      logger.error('Failed to configure device', {
        deviceId,
        configuration,
        error: error.message
      });
      throw new AppError('Failed to configure device', 500, 'DEVICE_ERROR');
    }
  }
}

module.exports = new EnergyService();
