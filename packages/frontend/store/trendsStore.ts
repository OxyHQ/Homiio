import { create } from 'zustand';

// Trends State Interface
interface TrendsState {
  // Data
  trends: {
    marketTrends: any[];
    priceTrends: any[];
    demandTrends: any[];
    seasonalTrends: any[];
  };

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  setTrends: (trends: TrendsState['trends']) => void;
  setMarketTrends: (trends: any[]) => void;
  setPriceTrends: (trends: any[]) => void;
  setDemandTrends: (trends: any[]) => void;
  setSeasonalTrends: (trends: any[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useTrendsStore = create<TrendsState>()((set, get) => ({
  // Initial state
  trends: {
    marketTrends: [],
    priceTrends: [],
    demandTrends: [],
    seasonalTrends: [],
  },
  isLoading: false,
  error: null,

  // Actions
  setTrends: (trends) => set({ trends }),
  setMarketTrends: (trends) =>
    set((state) => ({
      trends: { ...state.trends, marketTrends: trends },
    })),
  setPriceTrends: (trends) =>
    set((state) => ({
      trends: { ...state.trends, priceTrends: trends },
    })),
  setDemandTrends: (trends) =>
    set((state) => ({
      trends: { ...state.trends, demandTrends: trends },
    })),
  setSeasonalTrends: (trends) =>
    set((state) => ({
      trends: { ...state.trends, seasonalTrends: trends },
    })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));

// Selector hooks for easier access
export const useTrendsSelectors = () => {
  const trends = useTrendsStore((state) => state.trends);
  const isLoading = useTrendsStore((state) => state.isLoading);
  const error = useTrendsStore((state) => state.error);

  return {
    trends,
    isLoading,
    error,
  };
};
