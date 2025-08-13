import { create } from 'zustand';

// Neighborhood State Interface
interface NeighborhoodState {
  // Data
  currentNeighborhood: {
    id: string;
    name: string;
    city: string;
    state: string;
    country: string;
    coordinates: {
      latitude: number;
      longitude: number;
    };
    stats: {
      averageRent: number;
      crimeRate: number;
      walkScore: number;
      transitScore: number;
      bikeScore: number;
    };
  } | null;
  nearbyNeighborhoods: Array<{
    id: string;
    name: string;
    distance: number;
    averageRent: number;
  }>;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  setCurrentNeighborhood: (neighborhood: NeighborhoodState['currentNeighborhood']) => void;
  setNearbyNeighborhoods: (neighborhoods: NeighborhoodState['nearbyNeighborhoods']) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useNeighborhoodStore = create<NeighborhoodState>()((set, get) => ({
  // Initial state
  currentNeighborhood: null,
  nearbyNeighborhoods: [],
  isLoading: false,
  error: null,

  // Actions
  setCurrentNeighborhood: (neighborhood) => set({ currentNeighborhood: neighborhood }),
  setNearbyNeighborhoods: (neighborhoods) => set({ nearbyNeighborhoods: neighborhoods }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));

// Selector hooks for easier access
export const useNeighborhoodSelectors = () => {
  const currentNeighborhood = useNeighborhoodStore((state) => state.currentNeighborhood);
  const nearbyNeighborhoods = useNeighborhoodStore((state) => state.nearbyNeighborhoods);
  const isLoading = useNeighborhoodStore((state) => state.isLoading);
  const error = useNeighborhoodStore((state) => state.error);

  return {
    currentNeighborhood,
    nearbyNeighborhoods,
    isLoading,
    error,
  };
};
