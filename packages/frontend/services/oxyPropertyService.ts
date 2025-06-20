/**
 * OxyServices-based Property Service
 * 
 * This service handles property operations using OxyServices for authentication
 * instead of refresh tokens. It provides the same interface as the original
 * PropertyService but with proper token management.
 * 
 * Usage:
 * ```typescript
 * import { oxyPropertyService } from '@/services/oxyPropertyService';
 * import { useOxy } from '@oxyhq/services';
 * 
 * const { oxyServices, activeSessionId } = useOxy();
 * 
 * const property = await oxyPropertyService.createProperty(
 *   propertyData,
 *   oxyServices,
 *   activeSessionId
 * );
 * ```
 */

import { OxyServices } from '@oxyhq/services';
import { oxyApiRequest, oxyApiGet, oxyApiPost, oxyApiPut, oxyApiDelete } from '@/utils/oxyApi';
import { Property, CreatePropertyData, PropertyFilters } from './propertyService';

class OxyPropertyService {
  private baseUrl = '/api/properties';

  /**
   * Create a new property using OxyServices authentication
   */
  async createProperty(
    data: CreatePropertyData,
    oxyServices: OxyServices,
    activeSessionId: string
  ): Promise<Property> {
    const response = await oxyApiPost(this.baseUrl, data, oxyServices, activeSessionId);
    return response.data; // Backend returns { success, message, data }
  }

  /**
   * Get all properties with optional filters
   */
  async getProperties(
    filters?: PropertyFilters,
    oxyServices?: OxyServices,
    activeSessionId?: string
  ): Promise<{
    properties: Property[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await oxyApiGet(this.baseUrl, filters, oxyServices, activeSessionId);
    return {
      properties: response.data || [],
      total: response.pagination?.total || 0,
      page: response.pagination?.page || 1,
      totalPages: response.pagination?.totalPages || 1,
    };
  }

  /**
   * Get a specific property by ID
   */
  async getProperty(
    id: string,
    oxyServices?: OxyServices,
    activeSessionId?: string
  ): Promise<Property> {
    const response = await oxyApiGet(`${this.baseUrl}/${id}`, undefined, oxyServices, activeSessionId);
    return response.data || response.property;
  }

  /**
   * Update an existing property
   */
  async updateProperty(
    id: string,
    data: Partial<CreatePropertyData>,
    oxyServices: OxyServices,
    activeSessionId: string
  ): Promise<Property> {
    const response = await oxyApiPut(`${this.baseUrl}/${id}`, data, oxyServices, activeSessionId);
    return response.data || response.property;
  }

  /**
   * Delete a property
   */
  async deleteProperty(
    id: string,
    oxyServices: OxyServices,
    activeSessionId: string
  ): Promise<void> {
    await oxyApiDelete(`${this.baseUrl}/${id}`, oxyServices, activeSessionId);
  }

  /**
   * Search properties
   */
  async searchProperties(
    query: string,
    filters?: Omit<PropertyFilters, 'search'>,
    oxyServices?: OxyServices,
    activeSessionId?: string
  ): Promise<{
    properties: Property[];
    total: number;
  }> {
    const params = { ...filters, search: query };
    const response = await oxyApiGet(`${this.baseUrl}/search`, params, oxyServices, activeSessionId);
    return {
      properties: response.data || [],
      total: response.pagination?.total || 0,
    };
  }

  /**
   * Get property statistics
   */
  async getPropertyStats(
    id: string,
    oxyServices: OxyServices,
    activeSessionId: string
  ): Promise<{
    totalRooms: number;
    occupiedRooms: number;
    availableRooms: number;
    monthlyRevenue: number;
    averageRent: number;
    occupancyRate: number;
  }> {
    const response = await oxyApiGet(`${this.baseUrl}/${id}/stats`, undefined, oxyServices, activeSessionId);
    return response.data || response.stats;
  }

  /**
   * Get property energy statistics
   */
  async getPropertyEnergyStats(
    id: string,
    period: 'day' | 'week' | 'month' = 'day',
    oxyServices: OxyServices,
    activeSessionId: string
  ): Promise<any> {
    const response = await oxyApiGet(
      `${this.baseUrl}/${id}/energy`,
      { period },
      oxyServices,
      activeSessionId
    );
    return response;
  }
}

export const oxyPropertyService = new OxyPropertyService();