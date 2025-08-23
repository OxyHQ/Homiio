import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';
import { PropertyType } from '@homiio/shared-types';

export interface PropertyFilters {
  type?: PropertyType;
  minPrice?: number;
  maxPrice?: number;
  city?: string;
  state?: string;
  amenities?: string[];
  furnished?: boolean;
  pets?: boolean;
  smoking?: boolean;
  minBedrooms?: number;
  maxBedrooms?: number;
  minBathrooms?: number;
  maxBathrooms?: number;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

import { Property as SharedProperty } from '@homiio/shared-types';
export type Property = SharedProperty;

export interface PropertySearchResult {
  property: Property;
  matchScore: number;
}

class PropertyService {
  private baseUrl = '/api/properties';

  // Get all properties with filters (legacy method)
  async getProperties(
    filters?: PropertyFilters,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<{
    properties: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(this.baseUrl, {
        params: filters,
        oxyServices,
        activeSessionId,
      });
      return {
        properties: response.data.results || response.data.properties || [],
        total: response.data.total || 0,
        page: response.data.page || 1,
        totalPages: response.data.totalPages || 1
      };
    } catch (error) {
      console.error('Error getting properties:', error);
      return { properties: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get rooms for a property
  async getPropertyRooms(
    propertyId: string,
    filters?: PropertyFilters,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<{
    rooms: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(`${this.baseUrl}`, {
        params: {
          ...filters,
          type: PropertyType.ROOM,
          parentPropertyId: propertyId
        },
        oxyServices,
        activeSessionId,
      });
      return {
        rooms: response.data.results || response.data.properties || [],
        total: response.data.total || 0,
        page: response.data.page || 1,
        totalPages: response.data.totalPages || 1
      };
    } catch (error) {
      console.error('Error getting property rooms:', error);
      return { rooms: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get all available rooms
  async getRooms(
    filters?: PropertyFilters,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<{
    rooms: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(this.baseUrl, {
        params: {
          ...filters,
          type: PropertyType.ROOM
        },
        oxyServices,
        activeSessionId,
      });
      return {
        rooms: response.data.results || response.data.properties || [],
        total: response.data.total || 0,
        page: response.data.page || 1,
        totalPages: response.data.totalPages || 1
      };
    } catch (error) {
      console.error('Error getting rooms:', error);
      return { rooms: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get all properties with filters and match scores
  async searchProperties(
    query: string,
    filters?: PropertyFilters,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<{
    properties: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(`${this.baseUrl}/search`, {
        params: { query, ...filters },
        oxyServices,
        activeSessionId,
      });
      return {
        properties: response.data.results || response.data.properties || [],
        total: response.data.total || 0,
        page: response.data.page || 1,
        totalPages: response.data.totalPages || 1
      };
    } catch (error) {
      console.error('Error searching properties:', error);
      return { properties: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get property details by ID
  async getPropertyById(
    propertyId: string,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<Property | null> {
    try {
      const response = await api.get(`${this.baseUrl}/${propertyId}`, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching property details:', error);
      return null;
    }
  }

  // Get properties by owner
  async getOwnerProperties(
    profileId: string,
    excludePropertyId?: string,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<{
    properties: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(`${this.baseUrl}`, {
        params: {
          profileId,
          excludeIds: excludePropertyId,
          sortBy: 'createdAt',
          sortOrder: 'desc'
        },
        oxyServices,
        activeSessionId,
      });
      return {
        properties: response.data.results || response.data.properties || [],
        total: response.data.total || 0,
        page: response.data.page || 1,
        totalPages: response.data.totalPages || 1
      };
    } catch (error) {
      console.error('Error getting owner properties:', error);
      return { properties: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get property rooms
  async getPropertyRooms(
    propertyId: string,
    filters?: any,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<{
    rooms: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(`${this.baseUrl}/${propertyId}/rooms`, {
        params: filters,
        oxyServices,
        activeSessionId,
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching property rooms:', error);
      return { rooms: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Calculate match score between property and preferences
  calculatePropertyMatchScore(property: Property, preferences: any): number {
    let score = 100;

    // Budget match
    if (preferences.budget && property.rent) {
      const rentAmount = property.rent.amount;
      if (rentAmount < preferences.budget.min || rentAmount > preferences.budget.max) {
        score -= 20;
      }
    }

    // Location match
    if (preferences.preferredLocations && preferences.preferredLocations.length > 0) {
      const locationMatch = preferences.preferredLocations.some(
        (loc: any) =>
          property.address.city.toLowerCase() === loc.city.toLowerCase() &&
          property.address.state.toLowerCase() === loc.state.toLowerCase()
      );
      if (!locationMatch) {
        score -= 15;
      }
    }

    // Property type match
    if (preferences.propertyType && property.type !== preferences.propertyType) {
      score -= 10;
    }

    // Lifestyle match
    if (preferences.lifestyle && property.rules) {
      // Pets
      if (preferences.lifestyle.pets && !property.rules.pets) {
        score -= 10;
      }

      // Smoking
      if (!preferences.lifestyle.smoking && property.rules.smoking) {
        score -= 10;
      }

      // Guests
      if (preferences.lifestyle.guests && !property.rules.guests) {
        score -= 5;
      }
    }

    // Move-in date match
    if (preferences.moveInDate && property.availability.availableFrom) {
      const preferredDate = new Date(preferences.moveInDate);
      const availableDate = new Date(property.availability.availableFrom);
      const diffDays = Math.abs(preferredDate.getTime() - availableDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (diffDays > 30) {
        score -= 15;
      }
    }

    // Amenities match
    if (preferences.desiredAmenities) {
      const matchedAmenities = preferences.desiredAmenities.filter((a: string) => 
        property.amenities.includes(a)
      );
      if (matchedAmenities.length < preferences.desiredAmenities.length / 2) {
        score -= 10;
      }
    }

    return Math.max(0, score);
  }

  // Format property price for display
  formatPropertyPrice(property: Property): string {
    if (!property.rent) return 'Contact for price';

    return property.rent.amount.toLocaleString('en-US', {
      style: 'currency',
      currency: property.rent.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }) + `/${property.rent.paymentFrequency.toLowerCase()}`;
  }

  // Get primary image URL
  getPrimaryImageUrl(property: Property): string | null {
    const primaryImage = property.images.find(img => img.isPrimary);
    return primaryImage?.url || property.images[0]?.url || null;
  }

  // Check if property is available
  isPropertyAvailable(property: Property): boolean {
    return property.availability.isAvailable;
  }

  // Get property type display name
  getPropertyTypeDisplay(type: PropertyType): string {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  // Find properties within bounds
  async findPropertiesInBounds(
    bounds: { west: number; south: number; east: number; north: number },
    filters?: PropertyFilters,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<{
    properties: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const params = {
        ...filters,
        bounds: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
        limit: 50 // Increase limit for map view
      };
      
      const response = await api.get(`${this.baseUrl}/search`, {
        params,
        oxyServices,
        activeSessionId,
      });
      
      return {
        properties: response.data.data || response.data.results || response.data.properties || [],
        total: response.data.total || 0,
        page: response.data.page || 1,
        totalPages: response.data.totalPages || 1
      };
    } catch (error) {
      console.error('Error finding properties in bounds:', error);
      return { properties: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get property statistics
  async getPropertyStats(
    propertyId: string,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<any> {
    try {
      const response = await api.get(`${this.baseUrl}/${propertyId}/stats`, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching property stats:', error);
      return null;
    }
  }

  // Create property
  async createProperty(
    data: Partial<Property>,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<Property> {
    try {
      const response = await api.post(this.baseUrl, data, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error creating property:', error);
      throw error;
    }
  }

  // Update property
  async updateProperty(
    propertyId: string,
    data: Partial<Property>,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<Property> {
    try {
      const response = await api.put(`${this.baseUrl}/${propertyId}`, data, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error updating property:', error);
      throw error;
    }
  }

  // Delete property
  async deleteProperty(
    propertyId: string,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<void> {
    try {
      await api.delete(`${this.baseUrl}/${propertyId}`, {
        oxyServices,
        activeSessionId,
      });
    } catch (error) {
      console.error('Error deleting property:', error);
      throw error;
    }
  }
}

export const propertyService = new PropertyService();