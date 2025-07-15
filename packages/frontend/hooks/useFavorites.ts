import { useCallback, useMemo } from 'react';
import { useFavoritesStore, useFavoritesSelectors } from '@/store/favoritesStore';
import { useSavedPropertiesStore, useSavedPropertiesSelectors } from '@/store/savedPropertiesStore';
import { useActiveProfile } from '@/hooks/useProfileQueries';
import { useOxy } from '@oxyhq/services';
import { FavoritesErrorHandler, FavoritesError } from '@/utils/favoritesErrorHandler';
import { FavoritesRetry } from '@/utils/favoritesRetry';
import { FavoritesPerformance } from '@/utils/favoritesPerformance';
import type { Property } from '@/services/propertyService';

interface UseFavoritesReturn {
  favoriteIds: string[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  toggleFavorite: (propertyId: string, propertyData?: Partial<Property>) => Promise<void>;
  isFavorite: (propertyId: string) => boolean;
  isPropertySaving: (propertyId: string) => boolean;
  addToFavorites: (propertyId: string, propertyData?: Partial<Property>) => Promise<void>;
  removeFromFavorites: (propertyId: string, propertyData?: Partial<Property>) => Promise<void>;
  clearError: () => void;
}

export const useFavorites = (): UseFavoritesReturn => {
  const { favorites, isLoading, error } = useFavoritesSelectors();
  const { addFavorite, removeFavorite, setLoading, setError, clearError: clearStoreError } = useFavoritesStore();
  const { savingPropertyIds, addSavingPropertyId, removeSavingPropertyId } = useSavedPropertiesStore();
  const { data: activeProfile } = useActiveProfile();
  const { oxyServices, activeSessionId } = useOxy();

  // Memoize favorite IDs for performance
  const favoriteIds = useMemo(() => favorites.map(fav => fav.id), [favorites]);

  // Memoize isFavorite function to prevent unnecessary re-renders
  const isFavorite = useCallback((propertyId: string): boolean => {
    if (!propertyId) return false;
    return favoriteIds.includes(propertyId);
  }, [favoriteIds]);

  const isPropertySaving = useCallback((propertyId: string): boolean => {
    if (!propertyId) return false;
    return savingPropertyIds.includes(propertyId);
  }, [savingPropertyIds]);

  const clearError = useCallback(() => {
    clearStoreError();
  }, [clearStoreError]);

  const handleApiError = useCallback((error: any, context: string): FavoritesError => {
    const favoritesError = FavoritesErrorHandler.createError(error, context);
    FavoritesErrorHandler.logError(favoritesError, context);
    
    if (FavoritesErrorHandler.shouldShowUserMessage(favoritesError)) {
      setError(favoritesError.userMessage);
    }
    
    return favoritesError;
  }, [setError]);

  const toggleFavorite = useCallback(async (propertyId: string, propertyData?: Partial<Property>) => {
    const endTimer = FavoritesPerformance.startTimer('toggleFavorite', propertyId);

    if (!propertyId) {
      console.warn('useFavorites: Cannot toggle favorite - missing property ID');
      endTimer(false, 'Missing property ID');
      return;
    }

    if (!oxyServices || !activeSessionId) {
      setError('Please sign in to manage favorites');
      endTimer(false, 'Not authenticated');
      return;
    }

    // Prevent duplicate requests
    if (isPropertySaving(propertyId)) {
      endTimer(false, 'Duplicate request');
      return;
    }

    try {
      // Get current state to avoid stale closure
      const currentFavorites = useFavoritesStore.getState().favorites;
      const currentFavoriteIds = currentFavorites.map(fav => fav.id);
      const currentlyFavorite = currentFavoriteIds.includes(propertyId);

      // Add to saving list
      addSavingPropertyId(propertyId);

      if (currentlyFavorite) {
        // Optimistic update: remove from favorites
        removeFavorite(propertyId);
        
        // API call with retry
        const result = await FavoritesRetry.execute(async () => {
          const { userApi } = await import('@/utils/api');
          return userApi.unsaveProperty(propertyId, oxyServices, activeSessionId);
        });

        if (!result.success) {
          throw new Error(result.error?.message || 'Failed to remove from favorites');
        }
      } else {
        // Optimistic update: add to favorites
        if (propertyData) {
          addFavorite(propertyId, 'property', propertyData);
        }
        
        // API call with retry
        const result = await FavoritesRetry.execute(async () => {
          const { userApi } = await import('@/utils/api');
          return userApi.saveProperty(propertyId, undefined, oxyServices, activeSessionId);
        });

        if (!result.success) {
          throw new Error(result.error?.message || 'Failed to add to favorites');
        }
      }

      endTimer(true);
    } catch (error: any) {
      // Revert optimistic update on error
      const currentFavorites = useFavoritesStore.getState().favorites;
      const currentFavoriteIds = currentFavorites.map(fav => fav.id);
      const currentlyFavorite = currentFavoriteIds.includes(propertyId);

      if (currentlyFavorite && !isFavorite(propertyId)) {
        // We were trying to add but it failed, so remove it
        removeFavorite(propertyId);
      } else if (!currentlyFavorite && isFavorite(propertyId)) {
        // We were trying to remove but it failed, so add it back
        if (propertyData) {
          addFavorite(propertyId, 'property', propertyData);
        }
      }

      const favoritesError = handleApiError(error, 'toggleFavorite');
      endTimer(false, favoritesError.message);
    } finally {
      // Remove from saving list
      removeSavingPropertyId(propertyId);
    }
  }, [oxyServices, activeSessionId, addFavorite, removeFavorite, addSavingPropertyId, removeSavingPropertyId, setError, isPropertySaving, isFavorite, handleApiError]);

  const addToFavorites = useCallback(async (propertyId: string, propertyData?: Partial<Property>) => {
    const endTimer = FavoritesPerformance.startTimer('addToFavorites', propertyId);

    if (!propertyId) {
      console.warn('useFavorites: Cannot add to favorites - missing property ID');
      endTimer(false, 'Missing property ID');
      return;
    }

    if (isFavorite(propertyId)) {
      endTimer(false, 'Already a favorite');
      return; // Already a favorite
    }

    if (!oxyServices || !activeSessionId) {
      setError('Please sign in to manage favorites');
      endTimer(false, 'Not authenticated');
      return;
    }

    // Prevent duplicate requests
    if (isPropertySaving(propertyId)) {
      endTimer(false, 'Duplicate request');
      return;
    }

    try {
      // Add to saving list
      addSavingPropertyId(propertyId);
      
      // Optimistic update
      if (propertyData) {
        addFavorite(propertyId, 'property', propertyData);
      }
      
      // API call with retry
      const result = await FavoritesRetry.execute(async () => {
        const { userApi } = await import('@/utils/api');
        return userApi.saveProperty(propertyId, undefined, oxyServices, activeSessionId);
      });

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to add to favorites');
      }

      endTimer(true);
    } catch (error: any) {
      // Revert optimistic update on error
      removeFavorite(propertyId);
      const favoritesError = handleApiError(error, 'addToFavorites');
      endTimer(false, favoritesError.message);
    } finally {
      removeSavingPropertyId(propertyId);
    }
  }, [favoriteIds, oxyServices, activeSessionId, addFavorite, removeFavorite, addSavingPropertyId, removeSavingPropertyId, setError, isFavorite, isPropertySaving, handleApiError]);

  const removeFromFavorites = useCallback(async (propertyId: string, propertyData?: Partial<Property>) => {
    const endTimer = FavoritesPerformance.startTimer('removeFromFavorites', propertyId);

    if (!propertyId) {
      console.warn('useFavorites: Cannot remove from favorites - missing property ID');
      endTimer(false, 'Missing property ID');
      return;
    }

    if (!isFavorite(propertyId)) {
      endTimer(false, 'Not a favorite');
      return; // Not a favorite
    }

    if (!oxyServices || !activeSessionId) {
      setError('Please sign in to manage favorites');
      endTimer(false, 'Not authenticated');
      return;
    }

    // Prevent duplicate requests
    if (isPropertySaving(propertyId)) {
      endTimer(false, 'Duplicate request');
      return;
    }

    try {
      // Add to saving list
      addSavingPropertyId(propertyId);
      
      // Optimistic update
      removeFavorite(propertyId);
      
      // API call with retry
      const result = await FavoritesRetry.execute(async () => {
        const { userApi } = await import('@/utils/api');
        return userApi.unsaveProperty(propertyId, oxyServices, activeSessionId);
      });

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to remove from favorites');
      }

      endTimer(true);
    } catch (error: any) {
      // Revert optimistic update on error
      if (propertyData) {
        addFavorite(propertyId, 'property', propertyData);
      }
      const favoritesError = handleApiError(error, 'removeFromFavorites');
      endTimer(false, favoritesError.message);
    } finally {
      removeSavingPropertyId(propertyId);
    }
  }, [favoriteIds, oxyServices, activeSessionId, addFavorite, removeFavorite, addSavingPropertyId, removeSavingPropertyId, setError, isFavorite, isPropertySaving, handleApiError]);

  return {
    favoriteIds,
    isLoading,
    isSaving: savingPropertyIds.length > 0,
    error,
    toggleFavorite,
    isFavorite,
    isPropertySaving,
    addToFavorites,
    removeFromFavorites,
    clearError,
  };
}; 