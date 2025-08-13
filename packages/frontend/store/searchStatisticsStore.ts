import { create } from 'zustand';

// Search Statistics State Interface
interface SearchStatisticsState {
  // Data
  statistics: {
    totalSearches: number;
    recentSearches: any[];
    popularSearches: any[];
    searchTrends: any[];
  };

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  setStatistics: (statistics: SearchStatisticsState['statistics']) => void;
  updateTotalSearches: (count: number) => void;
  addRecentSearch: (search: any) => void;
  setPopularSearches: (searches: any[]) => void;
  setSearchTrends: (trends: any[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useSearchStatisticsStore = create<SearchStatisticsState>()((set, get) => ({
  // Initial state
  statistics: {
    totalSearches: 0,
    recentSearches: [],
    popularSearches: [],
    searchTrends: [],
  },
  isLoading: false,
  error: null,

  // Actions
  setStatistics: (statistics) => set({ statistics }),
  updateTotalSearches: (count) =>
    set((state) => ({
      statistics: { ...state.statistics, totalSearches: count },
    })),
  addRecentSearch: (search) =>
    set((state) => ({
      statistics: {
        ...state.statistics,
        recentSearches: [search, ...state.statistics.recentSearches.slice(0, 9)],
      },
    })),
  setPopularSearches: (searches) =>
    set((state) => ({
      statistics: { ...state.statistics, popularSearches: searches },
    })),
  setSearchTrends: (trends) =>
    set((state) => ({
      statistics: { ...state.statistics, searchTrends: trends },
    })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));

// Selector hooks for easier access
export const useSearchStatisticsSelectors = () => {
  const statistics = useSearchStatisticsStore((state) => state.statistics);
  const isLoading = useSearchStatisticsStore((state) => state.isLoading);
  const error = useSearchStatisticsStore((state) => state.error);

  return {
    statistics,
    isLoading,
    error,
  };
};
