/**
 * EnergyData Model
 * Represents energy consumption data from Raspberry Pi devices
 */
class EnergyData {
  constructor(data = {}) {
    this.id = data.id || null;
    this.deviceId = data.deviceId || null;
    this.propertyId = data.propertyId || null;
    this.timestamp = data.timestamp || new Date();
    this.readings = {
      voltage: data.readings?.voltage || 0, // V
      current: data.readings?.current || 0, // A
      power: data.readings?.power || 0, // W
      energy: data.readings?.energy || 0, // kWh
      frequency: data.readings?.frequency || 0, // Hz
      powerFactor: data.readings?.powerFactor || 0
    };
    this.consumption = {
      daily: data.consumption?.daily || 0, // kWh
      weekly: data.consumption?.weekly || 0, // kWh
      monthly: data.consumption?.monthly || 0, // kWh
      cost: {
        daily: data.consumption?.cost?.daily || 0,
        weekly: data.consumption?.cost?.weekly || 0,
        monthly: data.consumption?.cost?.monthly || 0,
        currency: data.consumption?.cost?.currency || 'USD'
      }
    };
    this.sensors = data.sensors || []; // Array of individual sensor readings
    this.alerts = {
      highUsage: data.alerts?.highUsage || false,
      lowPowerFactor: data.alerts?.lowPowerFactor || false,
      voltage: data.alerts?.voltage || false,
      customThresholds: data.alerts?.customThresholds || []
    };
    this.metadata = {
      location: data.metadata?.location || '', // room, area
      description: data.metadata?.description || '',
      deviceModel: data.metadata?.deviceModel || '',
      firmwareVersion: data.metadata?.firmwareVersion || '',
      calibration: data.metadata?.calibration || {}
    };
    this.processed = data.processed || false;
    this.createdAt = data.createdAt || new Date();
  }

  // Calculate instantaneous power consumption
  getInstantaneousPower() {
    return this.readings.voltage * this.readings.current * this.readings.powerFactor;
  }

  // Check if reading is within normal parameters
  isNormal() {
    const voltageNormal = this.readings.voltage >= 110 && this.readings.voltage <= 125; // US standard
    const frequencyNormal = this.readings.frequency >= 59.5 && this.readings.frequency <= 60.5;
    const powerFactorNormal = this.readings.powerFactor >= 0.8;
    
    return voltageNormal && frequencyNormal && powerFactorNormal;
  }

  // Detect anomalies in energy consumption
  detectAnomalies(thresholds = {}) {
    const anomalies = [];
    
    if (this.readings.voltage < (thresholds.minVoltage || 110)) {
      anomalies.push('Low voltage detected');
    }
    
    if (this.readings.voltage > (thresholds.maxVoltage || 125)) {
      anomalies.push('High voltage detected');
    }
    
    if (this.readings.power > (thresholds.maxPower || 5000)) {
      anomalies.push('High power consumption detected');
    }
    
    if (this.readings.powerFactor < (thresholds.minPowerFactor || 0.8)) {
      anomalies.push('Low power factor detected');
    }
    
    return anomalies;
  }

  // Calculate energy efficiency rating
  getEfficiencyRating() {
    if (this.readings.powerFactor >= 0.95) return 'A';
    if (this.readings.powerFactor >= 0.9) return 'B';
    if (this.readings.powerFactor >= 0.85) return 'C';
    if (this.readings.powerFactor >= 0.8) return 'D';
    return 'F';
  }

  // Validation method
  validate() {
    const errors = [];
    
    if (!this.deviceId) errors.push('Device ID is required');
    if (!this.propertyId) errors.push('Property ID is required');
    if (!this.timestamp) errors.push('Timestamp is required');
    if (this.readings.voltage < 0) errors.push('Voltage cannot be negative');
    if (this.readings.current < 0) errors.push('Current cannot be negative');
    if (this.readings.power < 0) errors.push('Power cannot be negative');
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Convert to JSON for API responses
  toJSON() {
    return {
      id: this.id,
      deviceId: this.deviceId,
      propertyId: this.propertyId,
      timestamp: this.timestamp,
      readings: this.readings,
      consumption: this.consumption,
      sensors: this.sensors,
      alerts: this.alerts,
      metadata: this.metadata,
      instantaneousPower: this.getInstantaneousPower(),
      isNormal: this.isNormal(),
      anomalies: this.detectAnomalies(),
      efficiencyRating: this.getEfficiencyRating(),
      processed: this.processed,
      createdAt: this.createdAt
    };
  }
}

module.exports = EnergyData;
