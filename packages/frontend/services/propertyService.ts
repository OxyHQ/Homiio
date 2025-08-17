import { Property, PropertyFilters } from '@homiio/shared-types';
import { api } from '@/utils/api';

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
    const response = await api.get<{ properties: Property[]; page: number; total: number; totalPages: number }>('/api/properties', {
      params: filters,
    });
    return response.data;
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
    const response = await api.get<SearchPropertiesResponse>('/api/properties/search', {
      params,
    });
    return response.data;
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
    const response = await api.get<{ property: Property }>(`/api/properties/${id}`);
    return response.data.property;
  },
};