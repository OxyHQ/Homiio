import { useCallback, useMemo } from 'react';
import { useSavedPropertiesStore, useSavedPropertiesSelectors } from '@/store/savedPropertiesStore';
import { useActiveProfile } from '@/hooks/useProfileQueries';
import { useOxy } from '@oxyhq/services';
import { FavoritesErrorHandler, FavoritesError } from '@/utils/favoritesErrorHandler';
import { FavoritesRetry } from '@/utils/favoritesRetry';
import { FavoritesPerformance } from '@/utils/favoritesPerformance';
import type { Property } from '@homiio/shared-types';

interface UseSavedPropertiesReturn {
  savedPropertyIds: string[];
  savedProperties: Property[]; // For backward compatibility
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  toggleSaved: (propertyId: string, propertyData?: Partial<Property>) => Promise<void>;
  isSaved: (propertyId: string) => boolean;
  isPropertySaving: (propertyId: string) => boolean;
  saveProperty: (propertyId: string, propertyData?: Partial<Property>) => Promise<void>;
  unsaveProperty: (propertyId: string, propertyData?: Partial<Property>) => Promise<void>;
  clearError: () => void;
}

export const useSavedProperties = (): UseSavedPropertiesReturn => {
  const { savedItems, isLoading, error } = useSavedPropertiesSelectors();
  const {
    addSavedItem,
    removeSavedItem,
    setLoading,
    setError,
    clearError: clearStoreError,
    savingPropertyIds,
    addSavingPropertyId,
    removeSavingPropertyId,
  } = useSavedPropertiesStore();
  const { data: activeProfile } = useActiveProfile();
  const { oxyServices, activeSessionId } = useOxy();

  // Memoize saved property IDs for performance
  const savedPropertyIds = useMemo(() => savedItems.map((item) => item.id), [savedItems]);

  // Extract saved properties for backward compatibility
  const savedProperties = useMemo(() => {
    return savedItems
      .filter((item) => item.type === 'property')
      .map((item) => item.data)
      .filter(Boolean) as Property[];
  }, [savedItems]);

  // Memoize isSaved function to prevent unnecessary re-renders
  const isSaved = useCallback(
    (propertyId: string): boolean => {
      if (!propertyId) return false;
      return savedPropertyIds.includes(propertyId);
    },
    [savedPropertyIds],
  );

  const isPropertySaving = useCallback(
    (propertyId: string): boolean => {
      if (!propertyId) return false;
      return savingPropertyIds.includes(propertyId);
    },
    [savingPropertyIds],
  );

  const clearError = useCallback(() => {
    clearStoreError();
  }, [clearStoreError]);

  const handleApiError = useCallback(
    (error: any, context: string): FavoritesError => {
      const savedPropertiesError = FavoritesErrorHandler.createError(error, context);
      FavoritesErrorHandler.logError(savedPropertiesError, context);

      if (FavoritesErrorHandler.shouldShowUserMessage(savedPropertiesError)) {
        setError(savedPropertiesError.userMessage);
      }

      return savedPropertiesError;
    },
    [setError],
  );

  const toggleSaved = useCallback(
    async (propertyId: string, propertyData?: Partial<Property>) => {
      const endTimer = FavoritesPerformance.startTimer('toggleSaved', propertyId);

      if (!propertyId) {
        console.warn('useSavedProperties: Cannot toggle saved - missing property ID');
        endTimer(false, 'Missing property ID');
        return;
      }

      if (!oxyServices || !activeSessionId) {
        setError('Please sign in to manage saved properties');
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
        const currentSavedItems = useSavedPropertiesStore.getState().savedItems;
        const currentSavedIds = currentSavedItems.map((item) => item.id);
        const currentlySaved = currentSavedIds.includes(propertyId);

        // Add to saving list
        addSavingPropertyId(propertyId);

        if (currentlySaved) {
          // Optimistic update: remove from saved items
          removeSavedItem(propertyId);

          // API call with retry
          const result = await FavoritesRetry.execute(async () => {
            const { userApi } = await import('@/utils/api');
            return userApi.unsaveProperty(propertyId, oxyServices, activeSessionId);
          });

          if (!result.success) {
            throw new Error(result.error?.message || 'Failed to remove from saved properties');
          }
        } else {
          // Optimistic update: add to saved items
          if (propertyData) {
            addSavedItem(propertyId, 'property', propertyData);
          }

          // API call with retry
          const result = await FavoritesRetry.execute(async () => {
            const { userApi } = await import('@/utils/api');
            return userApi.saveProperty(propertyId, undefined, oxyServices, activeSessionId);
          });

          if (!result.success) {
            throw new Error(result.error?.message || 'Failed to add to saved properties');
          }
        }

        endTimer(true);
      } catch (error: any) {
        // Revert optimistic update on error
        const currentSavedItems = useSavedPropertiesStore.getState().savedItems;
        const currentSavedIds = currentSavedItems.map((item) => item.id);
        const currentlySaved = currentSavedIds.includes(propertyId);

        if (currentlySaved && !isSaved(propertyId)) {
          // We were trying to add but it failed, so remove it
          removeSavedItem(propertyId);
        } else if (!currentlySaved && isSaved(propertyId)) {
          // We were trying to remove but it failed, so add it back
          if (propertyData) {
            addSavedItem(propertyId, 'property', propertyData);
          }
        }

        const savedPropertiesError = handleApiError(error, 'toggleSaved');
        endTimer(false, savedPropertiesError.message);
      } finally {
        // Remove from saving list
        removeSavingPropertyId(propertyId);
      }
    },
    [
      oxyServices,
      activeSessionId,
      addSavedItem,
      removeSavedItem,
      addSavingPropertyId,
      removeSavingPropertyId,
      setError,
      isPropertySaving,
      isSaved,
      handleApiError,
    ],
  );

  const saveProperty = useCallback(
    async (propertyId: string, propertyData?: Partial<Property>) => {
      const endTimer = FavoritesPerformance.startTimer('saveProperty', propertyId);

      if (!propertyId) {
        console.warn('useSavedProperties: Cannot save property - missing property ID');
        endTimer(false, 'Missing property ID');
        return;
      }

      if (isSaved(propertyId)) {
        endTimer(false, 'Already saved');
        return; // Already saved
      }

      if (!oxyServices || !activeSessionId) {
        setError('Please sign in to manage saved properties');
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
          addSavedItem(propertyId, 'property', propertyData);
        }

        // API call with retry
        const result = await FavoritesRetry.execute(async () => {
          const { userApi } = await import('@/utils/api');
          return userApi.saveProperty(propertyId, undefined, oxyServices, activeSessionId);
        });

        if (!result.success) {
          throw new Error(result.error?.message || 'Failed to save property');
        }

        endTimer(true);
      } catch (error: any) {
        // Revert optimistic update on error
        removeSavedItem(propertyId);
        const savedPropertiesError = handleApiError(error, 'saveProperty');
        endTimer(false, savedPropertiesError.message);
      } finally {
        removeSavingPropertyId(propertyId);
      }
    },
    [
      savedPropertyIds,
      oxyServices,
      activeSessionId,
      addSavedItem,
      removeSavedItem,
      addSavingPropertyId,
      removeSavingPropertyId,
      setError,
      isSaved,
      isPropertySaving,
      handleApiError,
    ],
  );

  const unsaveProperty = useCallback(
    async (propertyId: string, propertyData?: Partial<Property>) => {
      const endTimer = FavoritesPerformance.startTimer('unsaveProperty', propertyId);

      if (!propertyId) {
        console.warn('useSavedProperties: Cannot unsave property - missing property ID');
        endTimer(false, 'Missing property ID');
        return;
      }

      if (!isSaved(propertyId)) {
        endTimer(false, 'Not saved');
        return; // Not saved
      }

      if (!oxyServices || !activeSessionId) {
        setError('Please sign in to manage saved properties');
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
        removeSavedItem(propertyId);

        // API call with retry
        const result = await FavoritesRetry.execute(async () => {
          const { userApi } = await import('@/utils/api');
          return userApi.unsaveProperty(propertyId, oxyServices, activeSessionId);
        });

        if (!result.success) {
          throw new Error(result.error?.message || 'Failed to unsave property');
        }

        endTimer(true);
      } catch (error: any) {
        // Revert optimistic update on error
        if (propertyData) {
          addSavedItem(propertyId, 'property', propertyData);
        }
        const savedPropertiesError = handleApiError(error, 'unsaveProperty');
        endTimer(false, savedPropertiesError.message);
      } finally {
        removeSavingPropertyId(propertyId);
      }
    },
    [
      savedPropertyIds,
      oxyServices,
      activeSessionId,
      addSavedItem,
      removeSavedItem,
      addSavingPropertyId,
      removeSavingPropertyId,
      setError,
      isSaved,
      isPropertySaving,
      handleApiError,
    ],
  );

  return {
    savedPropertyIds,
    savedProperties,
    isLoading,
    isSaving: savingPropertyIds.length > 0,
    error,
    toggleSaved,
    isSaved,
    isPropertySaving,
    saveProperty,
    unsaveProperty,
    clearError,
  };
};
