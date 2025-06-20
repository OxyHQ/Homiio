import api, { getCacheKey, setCacheEntry, getCacheEntry } from '@/utils/api';

export interface Property {
  id: string;
  title: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    coordinates?: {
      lat: number | null;
      lng: number | null;
    };
  };
  type: 'apartment' | 'house' | 'room' | 'studio';
  description?: string;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  rent: {
    amount: number;
    currency: string;
    paymentFrequency: 'monthly' | 'weekly' | 'daily';
    deposit: number;
    utilities: 'included' | 'excluded' | 'partial';
  };
  amenities?: string[];
  images?: string[];
  status: 'available' | 'occupied' | 'maintenance' | 'offline';
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  roomCount?: number;
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

export interface CreatePropertyData {
  title: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country?: string;
  };
  type: 'apartment' | 'house' | 'room' | 'studio';
  description?: string;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  rent: {
    amount: number;
    currency?: string;
    paymentFrequency?: 'monthly' | 'weekly' | 'daily';
    deposit?: number;
    utilities?: 'included' | 'excluded' | 'partial';
  };
  amenities?: string[];
  images?: string[];
}

export interface PropertyFilters {
  type?: string;
  status?: string;
  minRent?: number;
  maxRent?: number;
  bedrooms?: number;
  bathrooms?: number;
  search?: string;
  page?: number;
  limit?: number;
}

class PropertyService {
  private baseUrl = '/api/properties';

  async getProperties(filters?: PropertyFilters): Promise<{
    properties: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const cacheKey = getCacheKey(this.baseUrl, filters);
    const cached = getCacheEntry<any>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(this.baseUrl, { params: filters });
    const result = {
      properties: response.data.data || [],
      total: response.data.pagination?.total || 0,
      page: response.data.pagination?.page || 1,
      totalPages: response.data.pagination?.totalPages || 1,
    };
    setCacheEntry(cacheKey, result);
    return result;
  }

  async getProperty(id: string): Promise<Property> {
    const cacheKey = getCacheKey(`${this.baseUrl}/${id}`);
    const cached = getCacheEntry<Property>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(`${this.baseUrl}/${id}`);
    setCacheEntry(cacheKey, response.data.data || response.data.property);
    return response.data.data || response.data.property;
  }

  async createProperty(data: CreatePropertyData): Promise<Property> {
    const response = await api.post(this.baseUrl, data);
    
    // Clear properties cache
    this.clearPropertiesCache();
    
    return response.data.data; // Backend returns { success, message, data }
  }

  async updateProperty(id: string, data: Partial<CreatePropertyData>): Promise<Property> {
    const response = await api.put(`${this.baseUrl}/${id}`, data);
    
    // Clear related caches
    this.clearPropertyCache(id);
    this.clearPropertiesCache();
    
    return response.data.data || response.data.property;
  }

  async deleteProperty(id: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${id}`);
    
    // Clear related caches
    this.clearPropertyCache(id);
    this.clearPropertiesCache();
  }

  async searchProperties(query: string, filters?: Omit<PropertyFilters, 'search'>): Promise<{
    properties: Property[];
    total: number;
  }> {
    const params = { ...filters, search: query };
    const cacheKey = getCacheKey(`${this.baseUrl}/search`, params);
    const cached = getCacheEntry<any>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(`${this.baseUrl}/search`, { params });
    const result = {
      properties: response.data.data || [],
      total: response.data.pagination?.total || 0,
    };
    setCacheEntry(cacheKey, result, 60000); // 1 minute cache for search
    return result;
  }

  async getPropertyStats(id: string): Promise<{
    totalRooms: number;
    occupiedRooms: number;
    availableRooms: number;
    monthlyRevenue: number;
    averageRent: number;
    occupancyRate: number;
  }> {
    const cacheKey = getCacheKey(`${this.baseUrl}/${id}/stats`);
    const cached = getCacheEntry<any>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(`${this.baseUrl}/${id}/stats`);
    setCacheEntry(cacheKey, response.data.data || response.data.stats, 300000); // 5 minute cache
    return response.data.data || response.data.stats;
  }

  async getPropertyEnergyStats(id: string, period: 'day' | 'week' | 'month' = 'day'): Promise<any> {
    const cacheKey = getCacheKey(`${this.baseUrl}/${id}/energy`, { period });
    const cached = getCacheEntry<any>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(`${this.baseUrl}/${id}/energy`, { params: { period } });
    setCacheEntry(cacheKey, response.data, 60000); // 1 minute cache
    return response.data;
  }

  private clearPropertyCache(id: string) {
    const { clearCache } = require('@/utils/api');
    clearCache(`${this.baseUrl}/${id}`);
  }

  private clearPropertiesCache() {
    const { clearCache } = require('@/utils/api');
    clearCache(this.baseUrl);
  }
}

export const propertyService = new PropertyService();
