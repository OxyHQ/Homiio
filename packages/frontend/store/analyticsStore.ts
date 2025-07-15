import { create } from 'zustand';

// Analytics State Interface
interface AnalyticsState {
  // Data
  analytics: {
    userMetrics: {
      totalUsers: number;
      activeUsers: number;
      newUsers: number;
      retentionRate: number;
    };
    propertyMetrics: {
      totalProperties: number;
      activeListings: number;
      averageRent: number;
      occupancyRate: number;
    };
    searchMetrics: {
      totalSearches: number;
      averageSearchTime: number;
      popularSearches: any[];
      conversionRate: number;
    };
    revenueMetrics: {
      totalRevenue: number;
      monthlyRevenue: number;
      averageTransactionValue: number;
      growthRate: number;
    };
  };
  
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setAnalytics: (analytics: AnalyticsState['analytics']) => void;
  setUserMetrics: (metrics: AnalyticsState['analytics']['userMetrics']) => void;
  setPropertyMetrics: (metrics: AnalyticsState['analytics']['propertyMetrics']) => void;
  setSearchMetrics: (metrics: AnalyticsState['analytics']['searchMetrics']) => void;
  setRevenueMetrics: (metrics: AnalyticsState['analytics']['revenueMetrics']) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useAnalyticsStore = create<AnalyticsState>()(
  (set, get) => ({
    // Initial state
    analytics: {
      userMetrics: {
        totalUsers: 0,
        activeUsers: 0,
        newUsers: 0,
        retentionRate: 0,
      },
      propertyMetrics: {
        totalProperties: 0,
        activeListings: 0,
        averageRent: 0,
        occupancyRate: 0,
      },
      searchMetrics: {
        totalSearches: 0,
        averageSearchTime: 0,
        popularSearches: [],
        conversionRate: 0,
      },
      revenueMetrics: {
        totalRevenue: 0,
        monthlyRevenue: 0,
        averageTransactionValue: 0,
        growthRate: 0,
      },
    },
    isLoading: false,
    error: null,
    
    // Actions
    setAnalytics: (analytics) => set({ analytics }),
    setUserMetrics: (metrics) => set((state) => ({
      analytics: { ...state.analytics, userMetrics: metrics }
    })),
    setPropertyMetrics: (metrics) => set((state) => ({
      analytics: { ...state.analytics, propertyMetrics: metrics }
    })),
    setSearchMetrics: (metrics) => set((state) => ({
      analytics: { ...state.analytics, searchMetrics: metrics }
    })),
    setRevenueMetrics: (metrics) => set((state) => ({
      analytics: { ...state.analytics, revenueMetrics: metrics }
    })),
    setLoading: (loading) => set({ isLoading: loading }),
    setError: (error) => set({ error }),
    clearError: () => set({ error: null }),
  })
);

// Selector hooks for easier access
export const useAnalyticsSelectors = () => {
  const analytics = useAnalyticsStore((state) => state.analytics);
  const isLoading = useAnalyticsStore((state) => state.isLoading);
  const error = useAnalyticsStore((state) => state.error);

  return {
    analytics,
    isLoading,
    error,
  };
}; 