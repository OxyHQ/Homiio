import { api } from '@/utils/api';
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
  async getRecentlyViewedProperties(): Promise<RecentlyViewedResponse> {
    try {
      const response = await api.get('/api/profiles/me/recent-properties');
      return response.data;
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
  async trackPropertyView(propertyId: string): Promise<RecentlyViewedResponse> {
    try {
      const response = await api.post(`/api/profiles/me/recent-properties/${propertyId}`);
      return response.data;
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
  async clearRecentlyViewedProperties(): Promise<RecentlyViewedResponse> {
    try {
      const response = await api.delete('/api/profiles/me/recent-properties');
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to clear recently viewed properties',
      };
    }
  },
};

export default recentlyViewedService;
