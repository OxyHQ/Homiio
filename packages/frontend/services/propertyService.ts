import { api } from '@/utils/api';
import { resolveBackendImageUrl } from '@/utils/imageUrl';
import {
  PropertyType,
  PropertyFilters,
  Property,
  PropertyImage,
  PropertyAreaInsights,
  PropertyNearbyServices,
  CreatePropertyData,
  UpdatePropertyData,
} from '@homiio/shared-types';

// Re-export types for use in other files
export { Property, PropertyFilters, PropertyType } from '@homiio/shared-types';

export interface PropertySearchResult {
  property: Property;
  matchScore: number;
}

class PropertyService {
  private baseUrl = '/api/properties';

  // Get all properties with filters (legacy method)
  async getProperties(
    filters?: PropertyFilters,
  ): Promise<{
    properties: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(this.baseUrl, {
        params: filters,
      });
      return {
        properties: response.data.data || response.data.results || response.data.properties || [],
        total: response.data.pagination?.total || response.data.total || 0,
        page: response.data.pagination?.page || response.data.page || 1,
        totalPages: response.data.pagination?.totalPages || response.data.totalPages || 1
      };
    } catch (error) {
      return { properties: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get all available rooms
  async getRooms(
    filters?: PropertyFilters,
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
      });
      return {
        rooms: response.data.data || response.data.results || response.data.properties || [],
        total: response.data.pagination?.total || response.data.total || 0,
        page: response.data.pagination?.page || response.data.page || 1,
        totalPages: response.data.pagination?.totalPages || response.data.totalPages || 1
      };
    } catch (error) {
      return { rooms: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get all properties with filters and match scores
  async searchProperties(
    query: string,
    filters?: PropertyFilters,
  ): Promise<{
    properties: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(`${this.baseUrl}/search`, {
        params: { query, ...filters },
      });
      return {
        properties: response.data.data || response.data.results || response.data.properties || [],
        total: response.data.pagination?.total || response.data.total || 0,
        page: response.data.pagination?.page || response.data.page || 1,
        totalPages: response.data.pagination?.totalPages || response.data.totalPages || 1
      };
    } catch (error) {
      return { properties: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get property details by ID
  async getPropertyById(
    propertyId: string,
  ): Promise<Property | null> {
    try {
      const response = await api.get(`${this.baseUrl}/${propertyId}`);
      return response.data.data;
    } catch (error) {
      return null;
    }
  }

  // Get properties by owner
  async getOwnerProperties(
    profileId: string,
    excludePropertyId?: string,
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
        }
      });
      return {
        properties: response.data.data || response.data.results || response.data.properties || [],
        total: response.data.pagination?.total || response.data.total || 0,
        page: response.data.pagination?.page || response.data.page || 1,
        totalPages: response.data.pagination?.totalPages || response.data.totalPages || 1
      };
    } catch (error) {
      return { properties: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get property rooms
  async getPropertyRooms(
    propertyId: string,
    filters?: PropertyFilters,
  ): Promise<{
    rooms: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(`${this.baseUrl}/${propertyId}/rooms`, {
        params: filters,
      });
      return response.data;
    } catch (error) {
      return { rooms: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Calculate match score between property and preferences
  calculatePropertyMatchScore(property: Property, preferences: any): number {
    let score = 100;

    // Budget match — compare against the listing's monthly rent (the budget is
    // a long-term concept), falling back to the nightly rate for vacation-only
    // listings.
    const budgetAmount =
      property.longTermRent?.monthlyAmount ?? property.shortTermRent?.nightlyRate;
    if (preferences.budget && budgetAmount !== undefined) {
      if (budgetAmount < preferences.budget.min || budgetAmount > preferences.budget.max) {
        score -= 20;
      }
    }

    // Location match. Geo is relational: compare against the server-resolved
    // display NAMES (`cityName`/`regionName`), not the geo id references.
    if (preferences.preferredLocations && preferences.preferredLocations.length > 0) {
      const locationMatch = preferences.preferredLocations.some(
        (loc: any) =>
          property.address.cityName?.toLowerCase() === loc.city?.toLowerCase() &&
          property.address.regionName?.toLowerCase() === loc.state?.toLowerCase()
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
      if (preferences.lifestyle.pets && !property.rules.petsAllowed) {
        score -= 10;
      }

      // Smoking
      if (!preferences.lifestyle.smoking && property.rules.smokingAllowed) {
        score -= 10;
      }

      // Guests
      if (preferences.lifestyle.guests && !property.rules.guestsAllowed) {
        score -= 5;
      }
    }

    // Move-in date match
    if (preferences.moveInDate && property.availableFrom) {
      const preferredDate = new Date(preferences.moveInDate);
      const availableDate = new Date(property.availableFrom);
      const diffDays = Math.abs(preferredDate.getTime() - availableDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (diffDays > 30) {
        score -= 15;
      }
    }

    // Amenities match
    if (preferences.desiredAmenities && property.amenities) {
      const matchedAmenities = preferences.desiredAmenities.filter((a: string) => 
        property.amenities?.includes(a)
      );
      if (matchedAmenities.length < preferences.desiredAmenities.length / 2) {
        score -= 10;
      }
    }

    return Math.max(0, score);
  }

  // Format property price for display. Prefers the monthly (long-term) headline;
  // falls back to the nightly (short-term) rate for vacation-only listings.
  formatPropertyPrice(property: Property): string {
    const longTerm = property.longTermRent;
    const shortTerm = property.shortTermRent;
    const block = longTerm
      ? { amount: longTerm.monthlyAmount, currency: longTerm.currency, unit: 'month' }
      : shortTerm
        ? { amount: shortTerm.nightlyRate, currency: shortTerm.currency, unit: 'night' }
        : null;
    if (!block) return 'Contact for price';

    return block.amount.toLocaleString('en-US', {
      style: 'currency',
      currency: block.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }) + `/${block.unit}`;
  }

  // Get primary image URL, re-homed onto the active API origin so DB images that
  // baked in a dev/emulator host load on web/device alike (external URLs pass
  // through). See resolveBackendImageUrl.
  getPrimaryImageUrl(property: Property): string | null {
    if (!property.images || property.images.length === 0) return null;

    const primaryImage = property.images.find(img =>
      typeof img === 'object' && 'isPrimary' in img && img.isPrimary
    ) as PropertyImage | undefined;

    if (primaryImage && typeof primaryImage === 'object' && 'url' in primaryImage) {
      return resolveBackendImageUrl(primaryImage.url);
    }

    const firstImage = property.images[0];
    if (typeof firstImage === 'string') {
      return resolveBackendImageUrl(firstImage);
    } else if (typeof firstImage === 'object' && 'url' in firstImage) {
      return resolveBackendImageUrl(firstImage.url);
    }

    return null;
  }

  // Check if property is available
  isPropertyAvailable(property: Property): boolean {
    // Check if property status indicates availability
    return property.status === 'published';
  }

  // Get property type display name
  getPropertyTypeDisplay(type: PropertyType): string {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  // Find properties within bounds
  async findPropertiesInBounds(
    bounds: { west: number; south: number; east: number; north: number },
    filters?: PropertyFilters,
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
      });
      
      return {
        properties: response.data.data || response.data.results || response.data.properties || [],
        total: response.data.total || 0,
        page: response.data.page || 1,
        totalPages: response.data.totalPages || 1
      };
    } catch (error) {
      return { properties: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get property statistics
  async getPropertyStats(
    propertyId: string,
  ): Promise<any> {
    try {
      const response = await api.get(`${this.baseUrl}/${propertyId}/stats`);
      return response.data.data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Area price-insights for a property: how its price compares to similar
   * homes nearby (range, average, median, verdict, distribution, comparable
   * listings). Backed by `GET /api/properties/:id/area-insights`.
   *
   * Unwraps the `{ data }` envelope and lets transport/HTTP errors propagate
   * so the calling React Query hook owns the loading/error/empty states (and
   * the detail screen can fail soft by hiding the section).
   */
  async getAreaInsights(
    propertyId: string,
  ): Promise<PropertyAreaInsights> {
    const response = await api.get<{ data: PropertyAreaInsights }>(
      `${this.baseUrl}/${propertyId}/area-insights`,
    );
    return response.data.data;
  }

  /**
   * Everyday services near a property ("What's nearby"): for a fixed set of
   * categories (pharmacy, school, transit, …) whether each exists near the
   * listing, how many, and the distance to the nearest. Backed by
   * `GET /api/properties/:id/nearby-services` (sourced from OpenStreetMap).
   *
   * Mirrors `getAreaInsights`: unwraps the `{ data }` envelope and lets
   * transport/HTTP errors propagate so the calling React Query hook owns the
   * loading/error/empty states (the detail screen fails soft by hiding the
   * section).
   */
  async getNearbyServices(
    propertyId: string,
  ): Promise<PropertyNearbyServices> {
    const response = await api.get<{ data: PropertyNearbyServices }>(
      `${this.baseUrl}/${propertyId}/nearby-services`,
    );
    return response.data.data;
  }

  // Create property. Accepts the create DTO whose `address` is an AddressInput
  // (place NAMES + coordinates the backend resolves into the relational geo
  // chain), not a serialized Property.
  async createProperty(
    data: CreatePropertyData,
  ): Promise<Property> {
    try {
      const response = await api.post(this.baseUrl, data);
      return response.data.data;
    } catch (error) {
      throw error;
    }
  }

  // Update property. Accepts a partial update DTO (same AddressInput-based
  // `address` resolution as create).
  async updateProperty(
    propertyId: string,
    data: UpdatePropertyData,
  ): Promise<Property> {
    try {
      const response = await api.put(`${this.baseUrl}/${propertyId}`, data);
      return response.data.data;
    } catch (error) {
      throw error;
    }
  }

  // Delete property
  async deleteProperty(
    propertyId: string,
  ): Promise<void> {
    try {
      await api.delete(`${this.baseUrl}/${propertyId}`);
    } catch (error) {
      throw error;
    }
  }
}

export const propertyService = new PropertyService();