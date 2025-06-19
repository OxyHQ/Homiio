import api, { getCacheKey, setCacheEntry, getCacheEntry } from '@/utils/api';

export interface Room {
  id: string;
  propertyId: string;
  name: string;
  type: 'bedroom' | 'living_room' | 'kitchen' | 'bathroom' | 'office' | 'storage' | 'other';
  description?: string;
  size?: number;
  rent?: number;
  currency?: string;
  amenities?: string[];
  images?: string[];
  status: 'available' | 'occupied' | 'maintenance' | 'offline';
  tenantId?: string;
  leaseId?: string;
  createdAt: string;
  updatedAt: string;
  energyStats?: {
    current: {
      voltage: number;
      current: number;
      power: number;
      powerFactor: number;
      frequency: number;
    };
    consumption: {
      daily: number;
      weekly: number;
      monthly: number;
      cost: {
        daily: number;
        weekly: number;
        monthly: number;
        currency: string;
      };
    };
  };
}

export interface CreateRoomData {
  name: string;
  type: 'bedroom' | 'living_room' | 'kitchen' | 'bathroom' | 'office' | 'storage' | 'other';
  description?: string;
  size?: number;
  rent?: number;
  currency?: string;
  amenities?: string[];
  images?: string[];
}

export interface RoomFilters {
  type?: string;
  status?: string;
  minRent?: number;
  maxRent?: number;
  search?: string;
  page?: number;
  limit?: number;
}

class RoomService {
  private baseUrl = '/api/properties';

  async getRooms(propertyId: string, filters?: RoomFilters): Promise<{
    rooms: Room[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const url = `${this.baseUrl}/${propertyId}/rooms`;
    const cacheKey = getCacheKey(url, filters);
    const cached = getCacheEntry<any>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(url, { params: filters });
    setCacheEntry(cacheKey, response.data);
    return response.data;
  }

  async getRoom(propertyId: string, roomId: string): Promise<Room> {
    const url = `${this.baseUrl}/${propertyId}/rooms/${roomId}`;
    const cacheKey = getCacheKey(url);
    const cached = getCacheEntry<Room>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(url);
    setCacheEntry(cacheKey, response.data.room);
    return response.data.room;
  }

  async createRoom(propertyId: string, data: CreateRoomData): Promise<Room> {
    const url = `${this.baseUrl}/${propertyId}/rooms`;
    const response = await api.post(url, data);
    
    // Clear rooms cache for this property
    this.clearRoomsCache(propertyId);
    
    return response.data.room;
  }

  async updateRoom(propertyId: string, roomId: string, data: Partial<CreateRoomData>): Promise<Room> {
    const url = `${this.baseUrl}/${propertyId}/rooms/${roomId}`;
    const response = await api.put(url, data);
    
    // Clear related caches
    this.clearRoomCache(propertyId, roomId);
    this.clearRoomsCache(propertyId);
    
    return response.data.room;
  }

  async deleteRoom(propertyId: string, roomId: string): Promise<void> {
    const url = `${this.baseUrl}/${propertyId}/rooms/${roomId}`;
    await api.delete(url);
    
    // Clear related caches
    this.clearRoomCache(propertyId, roomId);
    this.clearRoomsCache(propertyId);
  }

  async searchRooms(propertyId: string, query: string, filters?: Omit<RoomFilters, 'search'>): Promise<{
    rooms: Room[];
    total: number;
  }> {
    const url = `${this.baseUrl}/${propertyId}/rooms/search`;
    const params = { ...filters, search: query };
    const cacheKey = getCacheKey(url, params);
    const cached = getCacheEntry<any>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(url, { params });
    setCacheEntry(cacheKey, response.data, 60000); // 1 minute cache for search
    return response.data;
  }

  async getRoomStats(propertyId: string, roomId: string): Promise<{
    occupancyRate: number;
    averageStayDuration: number;
    monthlyRevenue: number;
    maintenanceRequests: number;
    energyConsumption: number;
  }> {
    const url = `${this.baseUrl}/${propertyId}/rooms/${roomId}/stats`;
    const cacheKey = getCacheKey(url);
    const cached = getCacheEntry<any>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(url);
    setCacheEntry(cacheKey, response.data.stats, 300000); // 5 minute cache
    return response.data.stats;
  }

  async getRoomEnergyStats(propertyId: string, roomId: string, period: 'day' | 'week' | 'month' = 'day'): Promise<any> {
    const url = `${this.baseUrl}/${propertyId}/rooms/${roomId}/energy`;
    const cacheKey = getCacheKey(url, { period });
    const cached = getCacheEntry<any>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(url, { params: { period } });
    setCacheEntry(cacheKey, response.data, 60000); // 1 minute cache
    return response.data;
  }

  async assignTenant(propertyId: string, roomId: string, tenantId: string): Promise<Room> {
    const url = `${this.baseUrl}/${propertyId}/rooms/${roomId}/assign`;
    const response = await api.post(url, { tenantId });
    
    // Clear related caches
    this.clearRoomCache(propertyId, roomId);
    this.clearRoomsCache(propertyId);
    
    return response.data.room;
  }

  async unassignTenant(propertyId: string, roomId: string): Promise<Room> {
    const url = `${this.baseUrl}/${propertyId}/rooms/${roomId}/unassign`;
    const response = await api.post(url);
    
    // Clear related caches
    this.clearRoomCache(propertyId, roomId);
    this.clearRoomsCache(propertyId);
    
    return response.data.room;
  }

  private clearRoomCache(propertyId: string, roomId: string) {
    const { clearCache } = require('@/utils/api');
    clearCache(`${this.baseUrl}/${propertyId}/rooms/${roomId}`);
  }

  private clearRoomsCache(propertyId: string) {
    const { clearCache } = require('@/utils/api');
    clearCache(`${this.baseUrl}/${propertyId}/rooms`);
  }
}

export const roomService = new RoomService();
