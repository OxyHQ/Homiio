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
  type: 'apartment' | 'house' | 'room' | 'studio' | 'couchsurfing' | 'roommates' | 'coliving' | 'hostel' | 'guesthouse' | 'campsite' | 'boat' | 'treehouse' | 'yurt' | 'other';
  housingType?: 'private' | 'public'; // Distinguishes private vs public housing
  layoutType?: 'open' | 'shared' | 'partitioned' | 'traditional' | 'studio' | 'other';
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
  priceUnit?: 'day' | 'night' | 'week' | 'month' | 'year';
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
  // Accommodation-specific details
  accommodationDetails?: {
    sleepingArrangement?: 'couch' | 'air_mattress' | 'floor' | 'tent' | 'hammock';
    roommatePreferences?: string[];
    colivingFeatures?: string[];
    hostelRoomType?: 'dormitory' | 'private_room' | 'mixed_dorm' | 'female_dorm' | 'male_dorm';
    campsiteType?: 'tent_site' | 'rv_site' | 'cabin' | 'glamping' | 'backcountry';
    maxStay?: number;
    minAge?: number;
    maxAge?: number;
    languages?: string[];
    culturalExchange?: boolean;
    mealsIncluded?: boolean;
    wifiPassword?: string;
    houseRules?: string[];
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
  type: 'apartment' | 'house' | 'room' | 'studio' | 'couchsurfing' | 'roommates' | 'coliving' | 'hostel' | 'guesthouse' | 'campsite' | 'boat' | 'treehouse' | 'yurt' | 'other';
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
  priceUnit?: 'day' | 'night' | 'week' | 'month' | 'year';
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
  // Accommodation-specific details
  accommodationDetails?: {
    sleepingArrangement?: 'couch' | 'air_mattress' | 'floor' | 'tent' | 'hammock';
    roommatePreferences?: string[];
    colivingFeatures?: string[];
    hostelRoomType?: 'dormitory' | 'private_room' | 'mixed_dorm' | 'female_dorm' | 'male_dorm';
    campsiteType?: 'tent_site' | 'rv_site' | 'cabin' | 'glamping' | 'backcountry';
    maxStay?: number;
    minAge?: number;
    maxAge?: number;
    languages?: string[];
    culturalExchange?: boolean;
    mealsIncluded?: boolean;
    wifiPassword?: string;
    houseRules?: string[];
  };
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

export interface EthicalPricingRequest {
  localMedianIncome: number;
  areaAverageRent: number;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
}

export interface EthicalPricingResponse {
  success: boolean;
  data: {
    suggestions: {
      standardRent: number;
      affordableRent: number;
      marketRate: number;
      reducedDeposit: number;
      communityRent: number;
      slidingScaleBase: number;
      slidingScaleMax: number;
      marketAdjustedRent: number;
      incomeBasedRent: number;
    };
    marketContext: string;
    warnings: string[];
    calculations: {
      monthlyMedianIncome: number;
      rentToIncomeRatio: number;
      standardRentPercentage: number;
      affordableRentPercentage: number;
      communityRentPercentage: number;
    };
  };
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
    const property = response.data.data || response.data.property;
    property.id = property._id || property.id || '';
    return property;
  }

  async createProperty(data: CreatePropertyData, oxyServices: any, activeSessionId: string): Promise<Property> {
    const response = await api.post(this.baseUrl, data, { oxyServices, activeSessionId });
    
    // Log the response for debugging
    console.log('API response:', JSON.stringify(response.data));
    
    // Handle different response formats
    if (response.data.data) {
      return response.data.data; // Standard format: { success, message, data }
    } else if (response.data.property) {
      return response.data.property; // Alternative format
    } else if (response.data._id) {
      return response.data; // Direct property object
    } else {
      console.error('Unexpected API response format:', response.data);
      throw new Error('Received unexpected response format from server');
    }
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

  async calculateEthicalPricing(data: EthicalPricingRequest): Promise<EthicalPricingResponse> {
    try {
      const response = await api.post(`${this.baseUrl}/calculate-ethical-pricing`, data);
      return response.data;
    } catch (error) {
      console.error('Error calculating ethical pricing:', error);
      throw new Error('Failed to calculate ethical pricing');
    }
  }
}

export const propertyService = new PropertyService();
