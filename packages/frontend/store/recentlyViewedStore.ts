import { create } from 'zustand';
import { Property, RecentlyViewedType } from '@homiio/shared-types';

// Recently Viewed State Interface
interface RecentlyViewedState {
  // Data
  items: Array<{
    id: string;
    type: RecentlyViewedType;
    data: any;
    viewedAt: string;
  }>;

  // Loading states
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  // Actions
  addItem: (id: string, type: RecentlyViewedType, data: any) => void;
  removeItem: (id: string) => void;
  clearAll: () => void;
  getRecentProperties: () => Property[];
  getRecentRooms: () => any[];
  getRecentRoommates: () => any[];

  // State management
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useRecentlyViewedStore = create<RecentlyViewedState>()((set, get) => ({
  // Initial state
  items: [],
  isLoading: false,
  isInitialized: false,
  error: null,

  // Actions
  addItem: (id, type, data) =>
    set((state) => {
      const newItem = {
        id,
        type,
        data,
        viewedAt: new Date().toISOString(),
      };

      // Remove any existing item with the same id to prevent duplicates
      const filteredItems = state.items.filter((item) => item.id !== id);
      
      // Add new item to the beginning and keep only the 20 most recent
      const updatedItems = [newItem, ...filteredItems].slice(0, 20);
      
      return { items: updatedItems };
    }),

  removeItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    })),

  clearAll: () => set({ items: [] }),

  getRecentProperties: () => {
    const state = get();
    return state.items
      .filter((item) => item.type === RecentlyViewedType.PROPERTY)
      .map((item) => item.data)
      .slice(0, 10);
  },

  getRecentRooms: () => {
    const state = get();
    return state.items
      .filter((item) => item.type === RecentlyViewedType.ROOM)
      .map((item) => item.data)
      .slice(0, 10);
  },

  getRecentRoommates: () => {
    const state = get();
    return state.items
      .filter((item) => item.type === RecentlyViewedType.ROOMMATE)
      .map((item) => item.data)
      .slice(0, 10);
  },

  // State management
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));

// Selector hooks for easier access
export const useRecentlyViewedSelectors = () => {
  const items = useRecentlyViewedStore((state) => state.items);
  const isLoading = useRecentlyViewedStore((state) => state.isLoading);
  const isInitialized = useRecentlyViewedStore((state) => state.isInitialized);
  const error = useRecentlyViewedStore((state) => state.error);
  const getRecentProperties = useRecentlyViewedStore((state) => state.getRecentProperties);
  const getRecentRooms = useRecentlyViewedStore((state) => state.getRecentRooms);
  const getRecentRoommates = useRecentlyViewedStore((state) => state.getRecentRoommates);

  return {
    items,
    isLoading,
    isInitialized,
    error,
    getRecentProperties,
    getRecentRooms,
    getRecentRoommates,
  };
};
