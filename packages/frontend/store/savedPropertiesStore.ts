import { create } from 'zustand';
import { Property } from '@homiio/shared-types';

// Types for saved items
export type SavedItemType = 'property' | 'room' | 'roommate';

export interface SavedItem {
  id: string;
  type: SavedItemType;
  data: any;
  addedAt: string;
}

// Saved Properties State Interface
interface SavedPropertiesState {
  // Data
  properties: Property[];
  folders: any[];
  savedItems: SavedItem[]; // Unified saved items
  savingPropertyIds: string[];

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  setProperties: (properties: Property[]) => void;
  setFolders: (folders: any[]) => void;
  addFolder: (folder: any) => void;
  updateFolderLocal: (folderId: string, folder: any) => void;
  removeFolderLocal: (folderId: string) => void;
  adjustFolderCount: (folderId: string, delta: number) => void;
  addProperty: (property: Property) => void;
  removeProperty: (propertyId: string) => void;
  updatePropertyNotes: (propertyId: string, notes: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  addSavingPropertyId: (propertyId: string) => void;
  removeSavingPropertyId: (propertyId: string) => void;
  clearError: () => void;
  
  // Saved items actions
  addSavedItem: (id: string, type: SavedItemType, data: any) => void;
  removeSavedItem: (id: string) => void;
  clearSavedItems: () => void;
  getSavedItemsByType: (type: SavedItemType) => any[];
  isSaved: (id: string) => boolean;
}

export const useSavedPropertiesStore = create<SavedPropertiesState>()((set, get) => ({
  // Initial state
  properties: [],
  folders: [],
  savedItems: [],
  savingPropertyIds: [],
  isLoading: false,
  error: null,

  // Actions
  setProperties: (properties) => set({ properties }),
  setFolders: (folders) => set({ folders }),
  addFolder: (folder) =>
    set((state) => ({
      folders: [...state.folders, folder],
    })),
  updateFolderLocal: (folderId, folder) =>
    set((state) => ({
      folders: state.folders.map((f: any) => (f._id === folderId ? { ...f, ...folder } : f)),
    })),
  removeFolderLocal: (folderId) =>
    set((state) => ({
      folders: state.folders.filter((f: any) => f._id !== folderId),
    })),
  adjustFolderCount: (folderId, delta) =>
    set((state) => ({
      folders: state.folders.map((f: any) =>
        f._id === folderId
          ? { ...f, propertyCount: Math.max(0, (f.propertyCount || 0) + delta) }
          : f,
      ),
    })),
  addProperty: (property) =>
    set((state) => ({
      properties: [...state.properties, property],
    })),
  removeProperty: (propertyId) =>
    set((state) => ({
      properties: state.properties.filter((p) => p.id !== propertyId),
    })),
  updatePropertyNotes: (propertyId, notes) =>
    set((state) => ({
      properties: state.properties.map((p) => (p.id === propertyId ? { ...p, notes } : p)),
    })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  addSavingPropertyId: (propertyId) =>
    set((state) => ({
      savingPropertyIds: [...state.savingPropertyIds, propertyId],
    })),
  removeSavingPropertyId: (propertyId) =>
    set((state) => ({
      savingPropertyIds: state.savingPropertyIds.filter((id) => id !== propertyId),
    })),
  clearError: () => set({ error: null }),

  // Saved items actions
  addSavedItem: (id, type, data) =>
    set((state) => {
      if (!id) {
        console.warn('savedPropertiesStore: Cannot add saved item - missing ID');
        return state;
      }

      const existingIndex = state.savedItems.findIndex((item) => item.id === id);
      if (existingIndex >= 0) {
        return state; // Already exists
      }

      return {
        savedItems: [{ id, type, data, addedAt: new Date().toISOString() }, ...state.savedItems],
      };
    }),

  removeSavedItem: (id) =>
    set((state) => {
      if (!id) {
        console.warn('savedPropertiesStore: Cannot remove saved item - missing ID');
        return state;
      }

      return {
        savedItems: state.savedItems.filter((item) => item.id !== id),
      };
    }),

  clearSavedItems: () => set({ savedItems: [] }),

  getSavedItemsByType: (type) => {
    const state = get();
    return state.savedItems.filter((item) => item.type === type).map((item) => item.data);
  },

  isSaved: (id) => {
    if (!id) return false;
    const state = get();
    return state.savedItems.some((item) => item.id === id);
  },
}));

// Selector hooks for easier access
export const useSavedPropertiesSelectors = () => {
  const properties = useSavedPropertiesStore((state) => state.properties);
  const savedItems = useSavedPropertiesStore((state) => state.savedItems);
  const savingPropertyIds = useSavedPropertiesStore((state) => state.savingPropertyIds);
  const isLoading = useSavedPropertiesStore((state) => state.isLoading);
  const error = useSavedPropertiesStore((state) => state.error);
  const getSavedItemsByType = useSavedPropertiesStore((state) => state.getSavedItemsByType);
  const isSaved = useSavedPropertiesStore((state) => state.isSaved);

  return {
    properties,
    savedItems,
    savingPropertyIds,
    isLoading,
    error,
    getSavedItemsByType,
    isSaved,
  };
};
