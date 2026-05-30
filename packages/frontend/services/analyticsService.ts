import { api } from '@/utils/api';

export type AnalyticsTrends = {
  propertyRevenue: { current: number; change: number; period: string };
  tenantSatisfaction: { current: number; change: number; period: string };
};

export type AnalyticsInsights = {
  totalInteractions: number;
  appsUsed: string[];
  crossAppActions: number;
  dataShared: number;
  insights: string[];
  trends: AnalyticsTrends;
};

export type AppStats = {
  totals: { properties: number; cities: number; saves: number; uniqueSavers: number };
  pricing: { averageRent: number; minRent: number; maxRent: number };
  topCities: { city: string; state: string; properties: number; averageRent: number }[];
  priceBuckets: { bucket: string; count: number }[];
};

/**
 * Some backend versions return the payload directly while others wrap it in a
 * `{ success, data }` envelope. This unwraps either shape to the inner `T`.
 */
type AnalyticsEnvelope<T> = T & { data?: T };

const unwrap = <T,>(payload: AnalyticsEnvelope<T>): T => payload.data ?? payload;

class AnalyticsService {
  private baseUrl = '/api/analytics';

  async getAnalytics(period: '7d' | '30d' | '90d' = '30d'): Promise<AnalyticsInsights> {
    try {
      const response = await api.get<AnalyticsEnvelope<AnalyticsInsights>>(
        this.baseUrl,
        { params: { period } },
      );
      // Some backends wrap payload under data.data
      return unwrap(response.data);
    } catch (error) {
      // Fallback to mock analytics similar to backend fallback
      return {
        totalInteractions: 145,
        appsUsed: ['homio', 'fairmint', 'horizon'],
        crossAppActions: 23,
        dataShared: 8,
        insights: [
          'Your usage is 15% below average',
          'You have 2 pending lease renewals',
          'Property occupancy rate is 85%',
        ],
        trends: {
          propertyRevenue: { current: 5200, change: 8, period: 'last_30_days' },
          tenantSatisfaction: { current: 4.2, change: 0.3, period: 'last_30_days' },
        },
      };
    }
  }

  async getAppStats(): Promise<AppStats> {
    try {
      const response = await api.get<AnalyticsEnvelope<AppStats>>(`${this.baseUrl}/stats`);
      return unwrap(response.data);
    } catch (error) {
      return {
        totals: { properties: 0, cities: 0, saves: 0, uniqueSavers: 0 },
        pricing: { averageRent: 0, minRent: 0, maxRent: 0 },
        topCities: [],
        priceBuckets: [],
      };
    }
  }
}

export const analyticsService = new AnalyticsService();


