import { create } from 'zustand';

// Location State Interface
interface LocationState {
  // Data
  currentLocation: {
    latitude: number;
    longitude: number;
    address: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
  } | null;
  searchResults: any[];
  searchHistory: Array<{
    query: string;
    timestamp: string;
    results: any[];
  }>;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  setCurrentLocation: (location: LocationState['currentLocation']) => void;
  setSearchResults: (results: any[]) => void;
  addSearchHistory: (query: string, results: any[]) => void;
  clearSearchHistory: () => void;
  clearSearchResults: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  // Initial state
  currentLocation: null,
  searchResults: [],
  searchHistory: [],
  isLoading: false,
  error: null,

  // Actions
  setCurrentLocation: (location) => set({ currentLocation: location }),
  setSearchResults: (results) => set({ searchResults: results }),
  addSearchHistory: (query, results) =>
    set((state) => ({
      searchHistory: [
        { query, results, timestamp: new Date().toISOString() },
        ...state.searchHistory,
      ].slice(0, 20), // Keep last 20 searches
    })),
  clearSearchHistory: () => set({ searchHistory: [] }),
  clearSearchResults: () => set({ searchResults: [] }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));

// Selector hooks for easier access
export const useLocationSelectors = () => {
  const currentLocation = useLocationStore((state) => state.currentLocation);
  const searchResults = useLocationStore((state) => state.searchResults);
  const searchHistory = useLocationStore((state) => state.searchHistory);
  const isLoading = useLocationStore((state) => state.isLoading);
  const error = useLocationStore((state) => state.error);

  return {
    currentLocation,
    searchResults,
    searchHistory,
    isLoading,
    error,
  };
};
