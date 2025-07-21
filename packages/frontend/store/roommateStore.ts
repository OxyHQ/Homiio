import { create } from 'zustand';

// Roommate State Interface
interface RoommateState {
  // Data
  roommates: any[];
  requests: {
    sent: any[];
    received: any[];
  };
  relationships: any[];
  currentRoommate: any | null;
  filters: {
    ageRange: [number, number];
    gender: string;
    occupation: string;
    lifestyle: string[];
    budget: [number, number];
  } | null;
  
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setRoommates: (roommates: any[]) => void;
  setRequests: (requests: { sent: any[]; received: any[] }) => void;
  setRelationships: (relationships: any[]) => void;
  setCurrentRoommate: (roommate: any | null) => void;
  setFilters: (filters: RoommateState['filters']) => void;
  clearFilters: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useRoommateStore = create<RoommateState>()(
  (set, get) => ({
    // Initial state
    roommates: [],
    requests: { sent: [], received: [] },
    relationships: [],
    currentRoommate: null,
    filters: null,
    isLoading: false,
    error: null,
    
    // Actions
    setRoommates: (roommates) => set({ roommates }),
    setRequests: (requests) => set({ requests }),
    setRelationships: (relationships) => set({ relationships }),
    setCurrentRoommate: (roommate) => set({ currentRoommate: roommate }),
    setFilters: (filters) => set({ filters }),
    clearFilters: () => set({ filters: null }),
    setLoading: (loading) => set({ isLoading: loading }),
    setError: (error) => set({ error }),
    clearError: () => set({ error: null }),
  })
);

// Selector hooks for easier access
export const useRoommateSelectors = () => {
  const roommates = useRoommateStore((state) => state.roommates);
  const requests = useRoommateStore((state) => state.requests);
  const relationships = useRoommateStore((state) => state.relationships);
  const currentRoommate = useRoommateStore((state) => state.currentRoommate);
  const filters = useRoommateStore((state) => state.filters);
  const isLoading = useRoommateStore((state) => state.isLoading);
  const error = useRoommateStore((state) => state.error);

  return {
    roommates,
    requests,
    relationships,
    currentRoommate,
    filters,
    isLoading,
    error,
  };
}; 