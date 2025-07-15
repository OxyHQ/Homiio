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
  addSearchHistory: (query: string, results: any[]) => void;
  clearSearchHistory: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  // Initial state
  currentLocation: null,
  searchHistory: [],
  isLoading: false,
  error: null,
  
  // Actions
  setCurrentLocation: (location) => set({ currentLocation: location }),
  addSearchHistory: (query, results) => set((state) => ({
    searchHistory: [
      { query, results, timestamp: new Date().toISOString() },
      ...state.searchHistory
    ].slice(0, 20) // Keep last 20 searches
  })),
  clearSearchHistory: () => set({ searchHistory: [] }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));

// Selector hooks for easier access
export const useLocationSelectors = () => {
  const currentLocation = useLocationStore((state) => state.currentLocation);
  const searchHistory = useLocationStore((state) => state.searchHistory);
  const isLoading = useLocationStore((state) => state.isLoading);
  const error = useLocationStore((state) => state.error);

  return {
    currentLocation,
    searchHistory,
    isLoading,
    error,
  };
}; 