import { Property, PropertyFilters } from '@homiio/shared-types';
import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';

export interface SearchPropertiesParams extends PropertyFilters {
  lat?: number;
  lng?: number;
  radius?: number;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  bathrooms?: number;
  page?: number;
  limit?: number;
}

export interface SearchPropertiesResponse {
  properties: Property[];
  total: number;
  page: number;
  pages: number;
}

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const propertyService = {
  async getProperties(filters?: PropertyFilters): Promise<{ properties: Property[]; page: number; total: number; totalPages: number }> {
    const response = await api.get<{ success: boolean; message: string; data: { properties: Property[]; page: number; total: number; totalPages: number } }>('/api/properties', {
      params: filters,
    });
    return response.data.data;
  },

  async findPropertiesInBounds(bounds: MapBounds, filters?: PropertyFilters): Promise<{ properties: Property[]; page: number; total: number; totalPages: number }> {
    // Calculate center point
    const longitude = bounds.west + (bounds.east - bounds.west) / 2;
    const latitude = bounds.south + (bounds.north - bounds.south) / 2;
    
    // Calculate radius in kilometers (using the larger dimension)
    const radiusKm = Math.max(
      Math.abs(bounds.east - bounds.west),
      Math.abs(bounds.north - bounds.south)
    ) * 111 / 2; // Convert degrees to km (roughly 111km per degree)

    const response = await api.get<{ 
      success: boolean;
      message: string;
      data: Property[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>('/api/properties/radius', {
      params: {
        ...filters,
        longitude,
        latitude,
        radius: radiusKm * 1000, // Convert to meters
      },
    });
    
    // Transform the API response to match our expected format
    return {
      properties: response.data.data,
      page: response.data.pagination.page,
      total: response.data.pagination.total,
      totalPages: response.data.pagination.totalPages,
    };
  },

  async searchProperties(params: SearchPropertiesParams): Promise<SearchPropertiesResponse> {
    const response = await api.get<{ success: boolean; message: string; data: SearchPropertiesResponse }>('/api/properties/search', {
      params,
    });
    return response.data.data;
  },

  async findPropertiesInRadius(lat: number, lng: number, radius: number): Promise<Property[]> {
    const response = await api.get<{ 
      success: boolean;
      message: string;
      data: Property[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>('/api/properties/radius', {
      params: { lat, lng, radius },
    });
    return response.data.data;
  },

  async getPropertyById(id: string): Promise<Property> {
    const response = await api.get<{ success: boolean; message: string; data: Property }>(`/api/properties/${id}`);
    return response.data.data;
  },

  // Add the missing getProperty method that the useProperty hook expects
  async getProperty(id: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<Property> {
    const response = await api.get<{ success: boolean; message: string; data: Property }>(`/api/properties/${id}`, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  },

  // Add missing methods that might be needed
  async getPropertyStats(id: string): Promise<any> {
    const response = await api.get<{ success: boolean; message: string; data: any }>(`/api/properties/${id}/stats`);
    return response.data.data;
  },

  async createProperty(data: any, oxyServices?: OxyServices, activeSessionId?: string): Promise<Property> {
    const response = await api.post<{ success: boolean; message: string; data: Property }>('/api/properties', data, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  },

  async updateProperty(id: string, data: any, oxyServices?: OxyServices, activeSessionId?: string): Promise<Property> {
    const response = await api.put<{ success: boolean; message: string; data: Property }>(`/api/properties/${id}`, data, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  },

  async deleteProperty(id: string): Promise<void> {
    await api.delete(`/api/properties/${id}`);
  },

  async getOwnerProperties(ownerId: string, excludePropertyId?: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<{ properties: Property[] }> {
    const response = await api.get<{ success: boolean; message: string; data: Property[] }>(`/api/properties/owner/${ownerId}`, {
      params: { exclude: excludePropertyId },
      oxyServices,
      activeSessionId,
    });
    return { properties: response.data.data };
  },
};