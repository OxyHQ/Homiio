import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import { 
  addPropertyOptimistic,
  removePropertyOptimistic,
  saveProperty,
  unsaveProperty,
} from '@/store/reducers/savedPropertiesReducer';
import { useActiveProfile } from '@/hooks/useProfileQueries';
import { useOxy } from '@oxyhq/services';
import type { Property } from '@/services/propertyService';

export const useFavorites = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { favoriteIds, isLoading, isSaving, error } = useSelector(
    (state: RootState) => state.savedProperties
  );
  const { data: activeProfile } = useActiveProfile();
  const { oxyServices, activeSessionId } = useOxy();

  const toggleFavorite = useCallback(async (propertyId: string, propertyData?: Partial<Property>) => {
    if (!oxyServices || !activeSessionId) {
      console.error('useFavorites: Cannot toggle favorite - missing services or session');
      return;
    }

    const isFavorite = favoriteIds.includes(propertyId);
    console.log(`useFavorites: Toggling favorite for ${propertyId}, currently favorite: ${isFavorite}`);

    if (isFavorite) {
      // Remove from favorites
      dispatch(removePropertyOptimistic(propertyId));
      
      try {
        await dispatch(unsaveProperty({ 
          propertyId, 
          oxyServices, 
          activeSessionId 
        })).unwrap();
        console.log(`useFavorites: Successfully removed ${propertyId} from favorites`);
      } catch (error) {
        console.error('useFavorites: Failed to remove from favorites:', error);
        // Revert optimistic update on error
        dispatch(addPropertyOptimistic({ propertyId, propertyData }));
      }
    } else {
      // Add to favorites
      dispatch(addPropertyOptimistic({ propertyId, propertyData }));
      
      try {
        await dispatch(saveProperty({ 
          propertyId, 
          oxyServices, 
          activeSessionId 
        })).unwrap();
        console.log(`useFavorites: Successfully added ${propertyId} to favorites`);
      } catch (error) {
        console.error('useFavorites: Failed to add to favorites:', error);
        // Revert optimistic update on error
        dispatch(removePropertyOptimistic(propertyId));
      }
    }
  }, [dispatch, favoriteIds, oxyServices, activeSessionId]);

  const isFavorite = useCallback((propertyId: string): boolean => {
    return favoriteIds.includes(propertyId);
  }, [favoriteIds]);

  const addToFavorites = useCallback(async (propertyId: string, propertyData?: Partial<Property>) => {
    if (favoriteIds.includes(propertyId)) {
      return; // Already a favorite
    }

    if (!oxyServices || !activeSessionId) {
      console.error('useFavorites: Cannot add to favorites - missing services or session');
      return;
    }

    console.log(`useFavorites: Adding ${propertyId} to favorites`);
    dispatch(addPropertyOptimistic({ propertyId, propertyData }));
    
    try {
      await dispatch(saveProperty({ 
        propertyId, 
        oxyServices, 
        activeSessionId 
      })).unwrap();
      console.log(`useFavorites: Successfully added ${propertyId} to favorites`);
    } catch (error) {
      console.error('useFavorites: Failed to add to favorites:', error);
      // Revert optimistic update on error
      dispatch(removePropertyOptimistic(propertyId));
    }
  }, [dispatch, favoriteIds, oxyServices, activeSessionId]);

  const removeFromFavorites = useCallback(async (propertyId: string, propertyData?: Partial<Property>) => {
    if (!favoriteIds.includes(propertyId)) {
      return; // Not a favorite
    }

    if (!oxyServices || !activeSessionId) {
      console.error('useFavorites: Cannot remove from favorites - missing services or session');
      return;
    }

    console.log(`useFavorites: Removing ${propertyId} from favorites`);
    dispatch(removePropertyOptimistic(propertyId));
    
    try {
      await dispatch(unsaveProperty({ 
        propertyId, 
        oxyServices, 
        activeSessionId 
      })).unwrap();
      console.log(`useFavorites: Successfully removed ${propertyId} from favorites`);
    } catch (error) {
      console.error('useFavorites: Failed to remove from favorites:', error);
      // Revert optimistic update on error
      dispatch(addPropertyOptimistic({ propertyId, propertyData }));
    }
  }, [dispatch, favoriteIds, oxyServices, activeSessionId]);

  return {
    favoriteIds,
    isLoading,
    isSaving,
    error,
    toggleFavorite,
    isFavorite,
    addToFavorites,
    removeFromFavorites,
  };
}; 