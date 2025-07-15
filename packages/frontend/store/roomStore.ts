import { create } from 'zustand';

// Room State Interface
interface RoomState {
  // Data
  rooms: any[];
  currentRoom: any | null;
  filters: {
    priceRange: [number, number];
    roomType: string[];
    amenities: string[];
    availability: string;
  } | null;
  
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setRooms: (rooms: any[]) => void;
  setCurrentRoom: (room: any | null) => void;
  setFilters: (filters: RoomState['filters']) => void;
  clearFilters: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useRoomStore = create<RoomState>()(
  (set, get) => ({
    // Initial state
    rooms: [],
    currentRoom: null,
    filters: null,
    isLoading: false,
    error: null,
    
    // Actions
    setRooms: (rooms) => set({ rooms }),
    setCurrentRoom: (room) => set({ currentRoom: room }),
    setFilters: (filters) => set({ filters }),
    clearFilters: () => set({ filters: null }),
    setLoading: (loading) => set({ isLoading: loading }),
    setError: (error) => set({ error }),
    clearError: () => set({ error: null }),
  })
);

// Selector hooks for easier access
export const useRoomSelectors = () => {
  const rooms = useRoomStore((state) => state.rooms);
  const currentRoom = useRoomStore((state) => state.currentRoom);
  const filters = useRoomStore((state) => state.filters);
  const isLoading = useRoomStore((state) => state.isLoading);
  const error = useRoomStore((state) => state.error);

  return {
    rooms,
    currentRoom,
    filters,
    isLoading,
    error,
  };
}; 