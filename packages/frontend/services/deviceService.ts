import api from '@/utils/api';

export interface Device {
  id: string;
  name: string;
  serialNumber: string;
  macAddress: string;
  type: 'raspberry-pi' | 'smart-meter' | 'sensor';
  propertyId: string;
  roomId?: string;
  ownerId: string;
  status: 'online' | 'offline' | 'error';
  configuration: {
    samplingRate?: number;
    alertThresholds?: {
      maxPower?: number;
      maxCurrent?: number;
      maxVoltage?: number;
      minVoltage?: number;
    };
    calibration?: {
      voltageMultiplier?: number;
      currentMultiplier?: number;
      powerFactor?: number;
    };
    network?: {
      wifi?: {
        ssid?: string;
        autoReconnect?: boolean;
      };
      mqtt?: {
        broker?: string;
        port?: number;
        keepAlive?: number;
      };
    };
    features?: {
      realTimeMonitoring?: boolean;
      alertsEnabled?: boolean;
      dataLogging?: boolean;
      remoteControl?: boolean;
    };
  };
  capabilities?: string[];
  lastSeen?: string;
  firmwareVersion?: string;
  hardwareVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeviceData {
  name: string;
  serialNumber: string;
  macAddress: string;
  type: 'raspberry-pi' | 'smart-meter' | 'sensor';
  propertyId: string;
  roomId?: string;
  configuration?: Device['configuration'];
}

export interface DeviceFilters {
  propertyId?: string;
  type?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface DeviceData {
  deviceId: string;
  readings: {
    voltage?: number;
    current?: number;
    power?: number;
    energy?: number;
    temperature?: number;
    humidity?: number;
  };
  timestamp?: string;
}

export interface DeviceStatus {
  deviceId: string;
  status: 'online' | 'offline' | 'error';
  lastSeen: string;
  uptime?: number;
  connectivity?: {
    signal?: string;
    ip?: string;
    gateway?: string;
  };
  health?: {
    cpu?: number;
    memory?: number;
    temperature?: number;
    batteryLevel?: number;
  };
  firmware?: {
    current?: string;
    latest?: string;
    updateAvailable?: boolean;
  };
  diagnostics?: {
    lastHeartbeat?: string;
    errorCount?: number;
    warnings?: string[];
  };
}

class DeviceService {
  private baseUrl = '/api/devices';

  async getDevices(filters?: DeviceFilters): Promise<{
    devices: Device[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await api.get(this.baseUrl, { params: filters });
    return response.data;
  }

  async getDevice(deviceId: string): Promise<Device> {
    const response = await api.get(`${this.baseUrl}/${deviceId}`);
    return response.data.data;
  }

  async createDevice(data: CreateDeviceData): Promise<Device> {
    const response = await api.post(this.baseUrl, data);
    return response.data.data;
  }

  async updateDevice(deviceId: string, data: Partial<CreateDeviceData>): Promise<Device> {
    const response = await api.put(`${this.baseUrl}/${deviceId}`, data);
    
    // Clear related caches
    this.clearDeviceCache(deviceId);
    this.clearDevicesCache();
    
    return response.data.data;
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${deviceId}`);
    
    // Clear related caches
    this.clearDeviceCache(deviceId);
    this.clearDevicesCache();
  }

  async getDeviceData(deviceId: string, options?: {
    startDate?: string;
    endDate?: string;
    period?: 'hour' | 'day' | 'week' | 'month';
    metric?: string;
  }): Promise<any> {
    const response = await api.get(`${this.baseUrl}/${deviceId}/data`, { params: options });
    return response.data.data;
  }

  async submitDeviceData(deviceId: string, data: DeviceData): Promise<void> {
    await api.post(`${this.baseUrl}/${deviceId}/data`, data);
  }

  async getDeviceConfig(deviceId: string): Promise<Device['configuration']> {
    const response = await api.get(`${this.baseUrl}/${deviceId}/config`);
    return response.data.data;
  }

  async updateDeviceConfig(deviceId: string, config: Partial<Device['configuration']>): Promise<void> {
    await api.put(`${this.baseUrl}/${deviceId}/config`, config);
  }

  async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    const response = await api.get(`${this.baseUrl}/${deviceId}/status`);
    return response.data.data;
  }

  async pingDevice(deviceId: string, status?: any, metrics?: any): Promise<void> {
    await api.post(`${this.baseUrl}/${deviceId}/ping`, { status, metrics });
  }

  private clearDeviceCache(deviceId: string) {
    const { clearCache } = require('@/utils/api');
    clearCache(`${this.baseUrl}/${deviceId}`);
  }

  private clearDevicesCache() {
    const { clearCache } = require('@/utils/api');
    clearCache(this.baseUrl);
  }

}

export const deviceService = new DeviceService();