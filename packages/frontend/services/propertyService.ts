import api from '@/utils/api';

export interface Property {
  _id: string; // MongoDB ObjectId
  id?: string; // Optional fallback
  profileId?: string; // Add profileId for landlord info
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
  housingType?: 'private' | 'public'; // Distinguishes private vs public housing
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
  // Title removed - will be generated dynamically when displaying properties
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country?: string;
  };
  type: 'apartment' | 'house' | 'room' | 'studio'; // Note: 'public' excluded - managed externally
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
  location?: {
    latitude: number;
    longitude: number;
  };
  // Additional comprehensive details for ethical pricing
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  isFurnished?: boolean;
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  hasBalcony?: boolean;
  hasGarden?: boolean;
  proximityToTransport?: boolean;
  proximityToSchools?: boolean;
  proximityToShopping?: boolean;
}

export interface PropertyFilters {
  type?: string;
  status?: string;
  available?: boolean;
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
    const response = await api.get(this.baseUrl, { params: filters });
    return {
      properties: response.data.data || [],
      total: response.data.pagination?.total || 0,
      page: response.data.pagination?.page || 1,
      totalPages: response.data.pagination?.totalPages || 1,
    };
  }

  async getProperty(id: string, oxyServices?: any, activeSessionId?: string): Promise<Property> {
    const response = await api.get(`${this.baseUrl}/${id}`, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data || response.data.property;
  }

  async createProperty(data: CreatePropertyData, oxyServices: any, activeSessionId: string): Promise<Property> {
    const response = await api.post(this.baseUrl, data, { oxyServices, activeSessionId });
    return response.data.data; // Backend returns { success, message, data }
  }

  async updateProperty(id: string, data: Partial<CreatePropertyData>): Promise<Property> {
    const response = await api.put(`${this.baseUrl}/${id}`, data);
    return response.data.data || response.data.property;
  }

  async deleteProperty(id: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${id}`);
  }

  async searchProperties(query: string, filters?: Omit<PropertyFilters, 'search'>): Promise<{
    properties: Property[];
    total: number;
  }> {
    const params = { ...filters, search: query };
    const response = await api.get(`${this.baseUrl}/search`, { params });
    return {
      properties: response.data.data || [],
      total: response.data.pagination?.total || 0,
    };
  }

  async getPropertyStats(id: string): Promise<{
    totalRooms: number;
    occupiedRooms: number;
    availableRooms: number;
    monthlyRevenue: number;
    averageRent: number;
    occupancyRate: number;
  }> {
    const response = await api.get(`${this.baseUrl}/${id}/stats`);
    return response.data.data || response.data.stats;
  }

  async getPropertyEnergyStats(id: string, period: 'day' | 'week' | 'month' = 'day'): Promise<any> {
    const response = await api.get(`${this.baseUrl}/${id}/energy`, { params: { period } });
    return response.data;
  }

}

export const propertyService = new PropertyService();
