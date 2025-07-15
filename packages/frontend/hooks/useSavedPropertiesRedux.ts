import { useCallback, useEffect } from 'react';
import { useSavedPropertiesStore, useSavedPropertiesSelectors } from '@/store/savedPropertiesStore';
import { useOxy } from '@oxyhq/services';
import type { Property } from '@/services/propertyService';

export interface UseSavedPropertiesReturn {
  properties: Property[];
  favoriteIds: string[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  loadProperties: () => Promise<void>;
  saveProperty: (propertyId: string, notes?: string, propertyData?: Partial<Property>) => Promise<void>;
  unsaveProperty: (propertyId: string) => Promise<void>;
  updateNotes: (propertyId: string, notes: string) => Promise<void>;
  isFavorite: (propertyId: string) => boolean;
  isPropertySaving: (propertyId: string) => boolean;
  clearError: () => void;
}

export const useSavedProperties = (): UseSavedPropertiesReturn => {
  const { properties, isLoading, error, savingPropertyIds } = useSavedPropertiesSelectors();
  const { 
    setProperties, 
    addProperty, 
    removeProperty, 
    updatePropertyNotes, 
    setLoading, 
    setError, 
    addSavingPropertyId, 
    removeSavingPropertyId, 
    clearError: clearErrorAction 
  } = useSavedPropertiesStore();
  const { oxyServices, activeSessionId } = useOxy();

  // Load properties on mount if not already loaded
  useEffect(() => {
    if (oxyServices && activeSessionId && !isLoading) {
      console.log('Zustand Hook: Auto-loading saved properties on mount');
      loadProperties();
    }
  }, [oxyServices, activeSessionId, isLoading]);

  const loadProperties = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      console.error('Zustand Hook: Cannot load properties - missing services or session');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      console.log('Zustand Hook: Manually loading saved properties');
      
      // Import the API function
      const { userApi } = await import('@/utils/api');
      const response = await userApi.getSavedProperties(oxyServices, activeSessionId);
      
      setProperties(response.data?.properties || response.data || []);
    } catch (error: any) {
      console.error('Zustand Hook: Failed to load saved properties:', error);
      setError(error.message || 'Failed to load saved properties');
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, setProperties, setLoading, setError]);

  const savePropertyHandler = useCallback(async (
    propertyId: string, 
    notes?: string, 
    propertyData?: Partial<Property>
  ) => {
    if (!oxyServices || !activeSessionId) {
      console.error('Zustand Hook: Cannot save property - missing services or session');
      return;
    }

    console.log('Zustand Hook: Saving property', propertyId);
    
    // Add to saving list
    addSavingPropertyId(propertyId);
    
    // Optimistic update first
    if (propertyData) {
      addProperty(propertyData as Property);
    }
    
    try {
      // Import the API function
      const { userApi } = await import('@/utils/api');
      await userApi.saveProperty(propertyId, notes, oxyServices, activeSessionId);
      
      console.log('Zustand Hook: Property saved successfully');
    } catch (error: any) {
      console.error('Zustand Hook: Failed to save property:', error);
      // Revert optimistic update on error
      if (propertyData) {
        removeProperty(propertyId);
      }
      setError(error.message || 'Failed to save property');
      throw error;
    } finally {
      removeSavingPropertyId(propertyId);
    }
  }, [oxyServices, activeSessionId, addProperty, removeProperty, addSavingPropertyId, removeSavingPropertyId, setError]);

  const unsavePropertyHandler = useCallback(async (propertyId: string) => {
    if (!oxyServices || !activeSessionId) {
      console.error('Zustand Hook: Cannot unsave property - missing services or session');
      return;
    }

    console.log('Zustand Hook: Unsaving property', propertyId);
    
    // Store current property data for potential revert
    const currentProperty = properties.find(p => (p._id || p.id) === propertyId);
    
    // Add to saving list
    addSavingPropertyId(propertyId);
    
    // Optimistic update first
    removeProperty(propertyId);
    
    try {
      // Import the API function
      const { userApi } = await import('@/utils/api');
      await userApi.unsaveProperty(propertyId, oxyServices, activeSessionId);
      
      console.log('Zustand Hook: Property unsaved successfully');
    } catch (error: any) {
      console.error('Zustand Hook: Failed to unsave property:', error);
      console.error('Zustand Hook: Full error details:', JSON.stringify(error, null, 2));
      
      // Revert optimistic update on error - re-add the property
      if (currentProperty) {
        addProperty(currentProperty);
        console.log('Zustand Hook: Reverted optimistic update for property', propertyId);
      }
      
      setError(error.message || 'Failed to unsave property');
      throw error;
    } finally {
      removeSavingPropertyId(propertyId);
    }
  }, [oxyServices, activeSessionId, properties, addProperty, removeProperty, addSavingPropertyId, removeSavingPropertyId, setError]);

  const updateNotesHandler = useCallback(async (propertyId: string, notes: string) => {
    if (!oxyServices || !activeSessionId) {
      console.error('Zustand Hook: Cannot update notes - missing services or session');
      return;
    }

    console.log('Zustand Hook: Updating notes for property', propertyId);
    
    // Optimistic update first
    updatePropertyNotes(propertyId, notes);
    
    try {
      // Import the API function
      const { userApi } = await import('@/utils/api');
      await userApi.updateSavedPropertyNotes(propertyId, notes, oxyServices, activeSessionId);
      
      console.log('Zustand Hook: Notes updated successfully');
    } catch (error: any) {
      console.error('Zustand Hook: Failed to update notes:', error);
      setError(error.message || 'Failed to update notes');
      // Note: Proper revert would require storing original notes
      throw error;
    }
  }, [oxyServices, activeSessionId, updatePropertyNotes, setError]);

  const isFavorite = useCallback((propertyId: string): boolean => {
    return properties.some(p => (p._id || p.id) === propertyId);
  }, [properties]);

  const isPropertySaving = useCallback((propertyId: string): boolean => {
    return savingPropertyIds.includes(propertyId);
  }, [savingPropertyIds]);

  const clearErrorHandler = useCallback(() => {
    clearErrorAction();
  }, [clearErrorAction]);

  return {
    properties,
    favoriteIds: properties.map(p => p._id || p.id || ''),
    isLoading,
    isSaving: savingPropertyIds.length > 0,
    error,
    loadProperties,
    saveProperty: savePropertyHandler,
    unsaveProperty: unsavePropertyHandler,
    updateNotes: updateNotesHandler,
    isFavorite,
    isPropertySaving,
    clearError: clearErrorHandler,
  };
};

// Additional hooks for specific operations
export const useSaveProperty = () => {
  const { saveProperty } = useSavedProperties();
  return { saveProperty };
};

export const useUnsaveProperty = () => {
  const { unsaveProperty } = useSavedProperties();
  return { unsaveProperty };
};

// Export the main hook as default
export default useSavedProperties; 