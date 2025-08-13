import { create } from 'zustand';
import { Property, RecentlyViewedType } from '@homiio/shared-types';
import { userApi } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';

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

  // Database operations
  loadFromDatabase: (oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  syncToDatabase: (oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  clearFromDatabase: (oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
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

      // Always add new item to the beginning and keep only the 20 most recent
      const updatedItems = [newItem, ...state.items].slice(0, 20);
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

  // Database operations
  loadFromDatabase: async (oxyServices, activeSessionId) => {
    const state = get();

    // Don't reload if already initialized and not forced
    if (state.isInitialized && state.items.length > 0) {
      console.log('RecentlyViewedStore: Already initialized, skipping database load');
      return;
    }

    set({ isLoading: true, error: null });

    try {
      console.log('RecentlyViewedStore: Loading recently viewed from database');
      const response = await userApi.getRecentProperties(oxyServices, activeSessionId);

      if (response.success && response.data) {
        // Transform database response to store format
        const items = response.data.map((property: any) => ({
          id: property._id || property.id,
          type: RecentlyViewedType.PROPERTY,
          data: property,
          viewedAt: property.viewedAt || new Date().toISOString(),
        }));

        set({
          items,
          isInitialized: true,
          isLoading: false,
          error: null,
        });

        console.log(`RecentlyViewedStore: Loaded ${items.length} items from database`);
      } else {
        set({
          items: [],
          isInitialized: true,
          isLoading: false,
          error: response.error || 'Failed to load recently viewed items',
        });
        console.error('RecentlyViewedStore: Failed to load from database:', response.error);
      }
    } catch (error) {
      console.error('RecentlyViewedStore: Error loading from database:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        isInitialized: true,
      });
    }
  },

  syncToDatabase: async (oxyServices, activeSessionId) => {
    const state = get();

    try {
      console.log('RecentlyViewedStore: Syncing to database');

      // For now, we'll rely on the backend tracking when properties are viewed
      // The backend already handles this in the property view endpoint
      // This method can be used for future bulk sync operations if needed

      console.log('RecentlyViewedStore: Sync completed (backend handles individual tracking)');
    } catch (error) {
      console.error('RecentlyViewedStore: Error syncing to database:', error);
      set({ error: error instanceof Error ? error.message : 'Sync failed' });
    }
  },

  clearFromDatabase: async (oxyServices, activeSessionId) => {
    set({ isLoading: true, error: null });

    try {
      console.log('RecentlyViewedStore: Clearing recently viewed from database');
      const response = await userApi.clearRecentProperties(oxyServices, activeSessionId);

      if (response.success) {
        set({
          items: [],
          isLoading: false,
          error: null,
        });
        console.log('RecentlyViewedStore: Successfully cleared from database');
      } else {
        set({
          isLoading: false,
          error: response.error || 'Failed to clear recently viewed items',
        });
        console.error('RecentlyViewedStore: Failed to clear from database:', response.error);
      }
    } catch (error) {
      console.error('RecentlyViewedStore: Error clearing from database:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Clear failed',
      });
    }
  },

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
