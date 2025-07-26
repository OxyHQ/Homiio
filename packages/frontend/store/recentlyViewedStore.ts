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
  
  // Actions
  addItem: (id: string, type: RecentlyViewedType, data: any) => void;
  removeItem: (id: string) => void;
  clearAll: () => void;
  getRecentProperties: () => Property[];
  getRecentRooms: () => any[];
  getRecentRoommates: () => any[];
}

export const useRecentlyViewedStore = create<RecentlyViewedState>()(
  (set, get) => ({
      // Initial state
      items: [],
      
      // Actions
      addItem: (id, type, data) => set((state) => {
        const existingIndex = state.items.findIndex(item => item.id === id);
        const newItem = {
          id,
          type,
          data,
          viewedAt: new Date().toISOString(),
        };
        
        if (existingIndex >= 0) {
          // Update existing item
          const updatedItems = [...state.items];
          updatedItems[existingIndex] = newItem;
          return { items: updatedItems };
        } else {
          // Add new item and keep only the 20 most recent
          const updatedItems = [newItem, ...state.items].slice(0, 20);
          return { items: updatedItems };
        }
      }),
      removeItem: (id) => set((state) => ({
        items: state.items.filter(item => item.id !== id)
      })),
      clearAll: () => set({ items: [] }),
      getRecentProperties: () => {
        const state = get();
        return state.items
          .filter(item => item.type === RecentlyViewedType.PROPERTY)
          .map(item => item.data)
          .slice(0, 10);
      },
      getRecentRooms: () => {
        const state = get();
        return state.items
          .filter(item => item.type === RecentlyViewedType.ROOM)
          .map(item => item.data)
          .slice(0, 10);
      },
      getRecentRoommates: () => {
        const state = get();
        return state.items
          .filter(item => item.type === RecentlyViewedType.ROOMMATE)
          .map(item => item.data)
          .slice(0, 10);
      },
    }
  )
);

// Selector hooks for easier access
export const useRecentlyViewedSelectors = () => {
  const items = useRecentlyViewedStore((state) => state.items);
  const getRecentProperties = useRecentlyViewedStore((state) => state.getRecentProperties);
  const getRecentRooms = useRecentlyViewedStore((state) => state.getRecentRooms);
  const getRecentRoommates = useRecentlyViewedStore((state) => state.getRecentRoommates);

  return {
    items,
    getRecentProperties,
    getRecentRooms,
    getRecentRoommates,
  };
}; 