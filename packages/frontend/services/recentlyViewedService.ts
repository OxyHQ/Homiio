import { userApi } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';
import type { Property } from '@homiio/shared-types';

export interface RecentlyViewedResponse {
  success: boolean;
  data?: Property[];
  error?: string;
}

export const recentlyViewedService = {
  /**
   * Get recently viewed properties
   */
  async getRecentlyViewedProperties(
    oxyServices: OxyServices,
    activeSessionId: string,
  ): Promise<RecentlyViewedResponse> {
    try {
      const response = await userApi.getRecentProperties(oxyServices, activeSessionId);
      return response;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to fetch recently viewed properties',
      };
    }
  },

  /**
   * Track property view
   */
  async trackPropertyView(
    propertyId: string,
    oxyServices: OxyServices,
    activeSessionId: string,
  ): Promise<RecentlyViewedResponse> {
    try {
      const response = await userApi.trackPropertyView(propertyId, oxyServices, activeSessionId);
      return response;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to track property view',
      };
    }
  },

  /**
   * Clear all recently viewed properties
   */
  async clearRecentlyViewedProperties(
    oxyServices: OxyServices,
    activeSessionId: string,
  ): Promise<RecentlyViewedResponse> {
    try {
      const response = await userApi.clearRecentProperties(oxyServices, activeSessionId);
      return response;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to clear recently viewed properties',
      };
    }
  },
};

export default recentlyViewedService;
