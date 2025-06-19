/**
 * Device Model
 * Represents Raspberry Pi devices for energy monitoring
 */
class Device {
  constructor(data = {}) {
    this.id = data.id || null;
    this.propertyId = data.propertyId || null;
    this.name = data.name || '';
    this.type = data.type || 'raspberry-pi'; // raspberry-pi, smart-meter, sensor
    this.model = data.model || 'Raspberry Pi 4';
    this.serialNumber = data.serialNumber || '';
    this.macAddress = data.macAddress || '';
    this.ipAddress = data.ipAddress || '';
    this.location = {
      room: data.location?.room || '',
      floor: data.location?.floor || '',
      coordinates: {
        x: data.location?.coordinates?.x || 0,
        y: data.location?.coordinates?.y || 0
      }
    };
    this.configuration = {
      samplingRate: data.configuration?.samplingRate || 60, // seconds
      dataRetention: data.configuration?.dataRetention || 365, // days
      alertThresholds: {
        maxPower: data.configuration?.alertThresholds?.maxPower || 5000, // W
        minVoltage: data.configuration?.alertThresholds?.minVoltage || 110, // V
        maxVoltage: data.configuration?.alertThresholds?.maxVoltage || 125, // V
        minPowerFactor: data.configuration?.alertThresholds?.minPowerFactor || 0.8
      },
      notifications: {
        email: data.configuration?.notifications?.email || false,
        sms: data.configuration?.notifications?.sms || false,
        push: data.configuration?.notifications?.push || true
      }
    };
    this.firmware = {
      version: data.firmware?.version || '1.0.0',
      lastUpdate: data.firmware?.lastUpdate || new Date(),
      autoUpdate: data.firmware?.autoUpdate || true
    };
    this.connectivity = {
      wifi: {
        ssid: data.connectivity?.wifi?.ssid || '',
        signalStrength: data.connectivity?.wifi?.signalStrength || 0, // dBm
        connected: data.connectivity?.wifi?.connected || false
      },
      ethernet: {
        connected: data.connectivity?.ethernet?.connected || false,
        speed: data.connectivity?.ethernet?.speed || '100Mbps'
      },
      cellular: {
        connected: data.connectivity?.cellular?.connected || false,
        carrier: data.connectivity?.cellular?.carrier || '',
        signalStrength: data.connectivity?.cellular?.signalStrength || 0
      }
    };
    this.status = {
      online: data.status?.online || false,
      lastSeen: data.status?.lastSeen || null,
      uptime: data.status?.uptime || 0, // seconds
      cpuUsage: data.status?.cpuUsage || 0, // percentage
      memoryUsage: data.status?.memoryUsage || 0, // percentage
      temperature: data.status?.temperature || 0, // Celsius
      diskUsage: data.status?.diskUsage || 0 // percentage
    };
    this.sensors = data.sensors || []; // Array of connected sensors
    this.isActive = data.isActive || true;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Check if device is currently online
  isOnline() {
    if (!this.status.lastSeen) return false;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return this.status.lastSeen > fiveMinutesAgo;
  }

  // Get connection status
  getConnectionStatus() {
    if (this.connectivity.ethernet.connected) return 'ethernet';
    if (this.connectivity.wifi.connected) return 'wifi';
    if (this.connectivity.cellular.connected) return 'cellular';
    return 'offline';
  }

  // Check if device needs firmware update
  needsFirmwareUpdate(latestVersion) {
    return this.firmware.version !== latestVersion;
  }

  // Get device health score (0-100)
  getHealthScore() {
    let score = 100;
    
    // Connectivity score
    if (!this.isOnline()) score -= 30;
    else if (this.getConnectionStatus() === 'cellular') score -= 10;
    
    // Performance score
    if (this.status.cpuUsage > 80) score -= 15;
    if (this.status.memoryUsage > 80) score -= 15;
    if (this.status.diskUsage > 90) score -= 20;
    
    // Temperature score
    if (this.status.temperature > 70) score -= 10; // Pi starts throttling at 80°C
    
    return Math.max(0, score);
  }

  // Update device status
  updateStatus(statusData) {
    this.status = { ...this.status, ...statusData };
    this.status.lastSeen = new Date();
    this.updatedAt = new Date();
  }

  // Validation method
  validate() {
    const errors = [];
    
    if (!this.propertyId) errors.push('Property ID is required');
    if (!this.name) errors.push('Device name is required');
    if (!this.serialNumber) errors.push('Serial number is required');
    if (!this.macAddress) errors.push('MAC address is required');
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Convert to JSON for API responses
  toJSON() {
    return {
      id: this.id,
      propertyId: this.propertyId,
      name: this.name,
      type: this.type,
      model: this.model,
      serialNumber: this.serialNumber,
      macAddress: this.macAddress,
      ipAddress: this.ipAddress,
      location: this.location,
      configuration: this.configuration,
      firmware: this.firmware,
      connectivity: this.connectivity,
      status: this.status,
      sensors: this.sensors,
      isOnline: this.isOnline(),
      connectionStatus: this.getConnectionStatus(),
      healthScore: this.getHealthScore(),
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Device;
