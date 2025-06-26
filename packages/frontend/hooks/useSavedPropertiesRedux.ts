import { useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import { 
  loadSavedProperties, 
  saveProperty, 
  unsaveProperty, 
  updatePropertyNotes,
  addPropertyOptimistic,
  removePropertyOptimistic,
  updatePropertyNotesOptimistic,
  clearError,
  SavedPropertyWithMeta
} from '@/store/reducers/savedPropertiesReducer';
import { useActiveProfile } from '@/hooks/useProfileQueries';
import { useOxy } from '@oxyhq/services';
import type { Property } from '@/services/propertyService';

export interface UseSavedPropertiesReturn {
  properties: SavedPropertyWithMeta[];
  favoriteIds: string[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  loadProperties: () => Promise<void>;
  saveProperty: (propertyId: string, notes?: string, propertyData?: Partial<Property>) => Promise<void>;
  unsaveProperty: (propertyId: string) => Promise<void>;
  updateNotes: (propertyId: string, notes: string) => Promise<void>;
  isFavorite: (propertyId: string) => boolean;
  clearError: () => void;
}

export const useSavedProperties = (): UseSavedPropertiesReturn => {
  const dispatch = useDispatch<AppDispatch>();
  const { properties, favoriteIds, isLoading, isSaving, error, lastSynced } = useSelector(
    (state: RootState) => state.savedProperties
  );
  const { data: activeProfile } = useActiveProfile();
  const { oxyServices, activeSessionId } = useOxy();

  // Load properties on mount if not already loaded
  useEffect(() => {
    if (oxyServices && activeSessionId && !lastSynced && !isLoading) {
      console.log('Redux Hook: Auto-loading saved properties on mount');
      dispatch(loadSavedProperties({ oxyServices, activeSessionId }));
    }
  }, [oxyServices, activeSessionId, lastSynced, isLoading, dispatch]);

  const loadProperties = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      console.error('Redux Hook: Cannot load properties - missing services or session');
      return;
    }

    console.log('Redux Hook: Manually loading saved properties');
    await dispatch(loadSavedProperties({ oxyServices, activeSessionId })).unwrap();
  }, [dispatch, oxyServices, activeSessionId]);

  const savePropertyHandler = useCallback(async (
    propertyId: string, 
    notes?: string, 
    propertyData?: Partial<Property>
  ) => {
    if (!oxyServices || !activeSessionId) {
      console.error('Redux Hook: Cannot save property - missing services or session');
      return;
    }

    console.log('Redux Hook: Saving property', propertyId);
    
    // Optimistic update first
    dispatch(addPropertyOptimistic({ propertyId, propertyData }));
    
    try {
      await dispatch(saveProperty({ 
        propertyId, 
        notes, 
        oxyServices, 
        activeSessionId 
      })).unwrap();
      
      console.log('Redux Hook: Property saved successfully');
    } catch (error) {
      console.error('Redux Hook: Failed to save property:', error);
      // Revert optimistic update on error
      dispatch(removePropertyOptimistic(propertyId));
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  const unsavePropertyHandler = useCallback(async (propertyId: string) => {
    if (!oxyServices || !activeSessionId) {
      console.error('Redux Hook: Cannot unsave property - missing services or session');
      return;
    }

    console.log('Redux Hook: Unsaving property', propertyId);
    
    // Store current property data for potential revert
    const currentProperty = properties.find(p => (p._id || p.id) === propertyId);
    
    // Optimistic update first
    dispatch(removePropertyOptimistic(propertyId));
    
    try {
      const result = await dispatch(unsaveProperty({ 
        propertyId, 
        oxyServices, 
        activeSessionId 
      })).unwrap();
      
      console.log('Redux Hook: Property unsaved successfully', result);
    } catch (error) {
      console.error('Redux Hook: Failed to unsave property:', error);
      console.error('Redux Hook: Full error details:', JSON.stringify(error, null, 2));
      
      // Revert optimistic update on error - re-add the property
      if (currentProperty) {
        dispatch(addPropertyOptimistic({ 
          propertyId, 
          propertyData: currentProperty 
        }));
        console.log('Redux Hook: Reverted optimistic update for property', propertyId);
      }
      
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId, properties]);

  const updateNotesHandler = useCallback(async (propertyId: string, notes: string) => {
    if (!oxyServices || !activeSessionId) {
      console.error('Redux Hook: Cannot update notes - missing services or session');
      return;
    }

    console.log('Redux Hook: Updating notes for property', propertyId);
    
    // Optimistic update first
    dispatch(updatePropertyNotesOptimistic({ propertyId, notes }));
    
    try {
      await dispatch(updatePropertyNotes({ 
        propertyId, 
        notes, 
        oxyServices, 
        activeSessionId 
      })).unwrap();
      
      console.log('Redux Hook: Notes updated successfully');
    } catch (error) {
      console.error('Redux Hook: Failed to update notes:', error);
      // Note: Proper revert would require storing original notes
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  const isFavorite = useCallback((propertyId: string): boolean => {
    return favoriteIds.includes(propertyId);
  }, [favoriteIds]);

  const clearErrorHandler = useCallback(() => {
    dispatch(clearError());
  }, [dispatch]);

  return {
    properties,
    favoriteIds,
    isLoading,
    isSaving,
    error,
    loadProperties,
    saveProperty: savePropertyHandler,
    unsaveProperty: unsavePropertyHandler,
    updateNotes: updateNotesHandler,
    isFavorite,
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