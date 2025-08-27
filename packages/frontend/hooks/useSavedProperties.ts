import { useCallback, useMemo } from 'react';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import type { Property } from '@homiio/shared-types';

interface UseSavedPropertiesReturn {
  savedPropertyIds: string[];
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
  const {
    savedProperties,
    isPropertySaved,
    isPropertySaving: isPropertySavingFromContext,
    savePropertyToFolder,
    unsaveProperty: unsavePropertyFromContext,
    isLoading,
    error,
  } = useSavedPropertiesContext();

  // Memoize saved property IDs for performance
  const savedPropertyIds = useMemo(() =>
    savedProperties.map((property: any) => property._id || property.id).filter(Boolean),
    [savedProperties]
  );

  // Use context's isPropertySaved method
  const isSaved = useCallback(
    (propertyId: string): boolean => {
      if (!propertyId) return false;
      return isPropertySaved(propertyId);
    },
    [isPropertySaved],
  );

  // Use context's isPropertySaving method for per-property loading state
  const isPropertySaving = useCallback(
    (propertyId: string): boolean => {
      if (!propertyId) return false;
      return isPropertySavingFromContext(propertyId);
    },
    [isPropertySavingFromContext],
  );

  const clearError = useCallback(() => {
    // TODO: Add clearError to context if needed
  }, []);

  const toggleSaved = useCallback(
    async (propertyId: string, propertyData?: Partial<Property>) => {
      if (!propertyId) {
        console.warn('useSavedProperties: Cannot toggle saved - missing property ID');
        return;
      }

      try {
        const currentlySaved = isSaved(propertyId);

        if (currentlySaved) {
          await unsavePropertyFromContext(propertyId);
        } else {
          await savePropertyToFolder(propertyId, null, propertyData);
        }
      } catch (error: any) {
        console.error('Failed to toggle saved property:', error);
        throw error;
      }
    },
    [isSaved, unsavePropertyFromContext, savePropertyToFolder],
  );

  const saveProperty = useCallback(
    async (propertyId: string, propertyData?: Partial<Property>) => {
      if (!propertyId) {
        console.warn('useSavedProperties: Cannot save property - missing property ID');
        return;
      }

      if (isSaved(propertyId)) {
        return; // Already saved
      }

      try {
        await savePropertyToFolder(propertyId, null, propertyData);
      } catch (error: any) {
        console.error('Failed to save property:', error);
        throw error;
      }
    },
    [isSaved, savePropertyToFolder],
  );

  const unsaveProperty = useCallback(
    async (propertyId: string, _propertyData?: Partial<Property>) => {
      if (!propertyId) {
        console.warn('useSavedProperties: Cannot unsave property - missing property ID');
        return;
      }

      if (!isSaved(propertyId)) {
        return; // Not saved
      }

      try {
        await unsavePropertyFromContext(propertyId);
      } catch (error: any) {
        console.error('Failed to unsave property:', error);
        throw error;
      }
    },
    [isSaved, unsavePropertyFromContext],
  );

  return {
    savedPropertyIds,
    isLoading,
    isSaving: false, // TODO: Add saving state tracking if needed
    error,
    toggleSaved,
    isSaved,
    isPropertySaving,
    saveProperty,
    unsaveProperty,
    clearError,
  };
};
