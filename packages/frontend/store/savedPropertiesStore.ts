import { create } from 'zustand';
import { Property } from '@homiio/shared-types';

// Saved Properties State Interface
interface SavedPropertiesState {
  // Data
  properties: Property[];
  savingPropertyIds: string[];
  
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setProperties: (properties: Property[]) => void;
  addProperty: (property: Property) => void;
  removeProperty: (propertyId: string) => void;
  updatePropertyNotes: (propertyId: string, notes: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  addSavingPropertyId: (propertyId: string) => void;
  removeSavingPropertyId: (propertyId: string) => void;
  clearError: () => void;
}

export const useSavedPropertiesStore = create<SavedPropertiesState>()(
  (set, get) => ({
      // Initial state
      properties: [],
      savingPropertyIds: [],
      isLoading: false,
      error: null,
      
      // Actions
      setProperties: (properties) => set({ properties }),
      addProperty: (property) => set((state) => ({
        properties: [...state.properties, property]
      })),
      removeProperty: (propertyId) => set((state) => ({
        properties: state.properties.filter(p => p.id !== propertyId)
      })),
      updatePropertyNotes: (propertyId, notes) => set((state) => ({
        properties: state.properties.map(p => 
          p.id === propertyId ? { ...p, notes } : p
        )
      })),
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
      addSavingPropertyId: (propertyId) => set((state) => ({
        savingPropertyIds: [...state.savingPropertyIds, propertyId]
      })),
      removeSavingPropertyId: (propertyId) => set((state) => ({
        savingPropertyIds: state.savingPropertyIds.filter(id => id !== propertyId)
      })),
      clearError: () => set({ error: null }),
    }
  )
);

// Selector hooks for easier access
export const useSavedPropertiesSelectors = () => {
  const properties = useSavedPropertiesStore((state) => state.properties);
  const savingPropertyIds = useSavedPropertiesStore((state) => state.savingPropertyIds);
  const isLoading = useSavedPropertiesStore((state) => state.isLoading);
  const error = useSavedPropertiesStore((state) => state.error);

  return {
    properties,
    savingPropertyIds,
    isLoading,
    error,
  };
}; 