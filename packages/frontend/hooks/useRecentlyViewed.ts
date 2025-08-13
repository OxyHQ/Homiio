import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';
import { useOxy } from '@oxyhq/services';
import type { Property } from '@homiio/shared-types';
import { RecentlyViewedType } from '@homiio/shared-types';
import { useEffect } from 'react';

export function useRecentlyViewed() {
  const {
    addItem,
    removeItem,
    clearAll,
    getRecentProperties,
    loadFromDatabase,
    syncToDatabase,
    clearFromDatabase,
    isLoading,
    isInitialized,
    error,
    setError,
    clearError,
  } = useRecentlyViewedStore();
  const { oxyServices, activeSessionId } = useOxy();

  // Debug logging
  console.log('useRecentlyViewed Hook Debug:', {
    oxyServices: !!oxyServices,
    activeSessionId: !!activeSessionId,
    propertiesCount: getRecentProperties().length,
    isLoading,
    isInitialized,
    error: error || null,
  });

  const properties = getRecentProperties();

  // Load data from database on mount if authenticated and not initialized
  useEffect(() => {
    if (oxyServices && activeSessionId && !isInitialized) {
      console.log('useRecentlyViewed: Loading from database on mount');
      loadFromDatabase(oxyServices, activeSessionId).catch((error) => {
        console.error('useRecentlyViewed: Failed to load from database:', error);
      });
    }
  }, [oxyServices, activeSessionId, isInitialized, loadFromDatabase]);

  const refetch = async () => {
    if (!oxyServices || !activeSessionId) {
      console.log('useRecentlyViewed: Cannot refetch - not authenticated');
      return;
    }

    console.log('useRecentlyViewed: Refetching from database');
    try {
      await loadFromDatabase(oxyServices, activeSessionId);
    } catch (error) {
      console.error('useRecentlyViewed: Refetch failed:', error);
    }
  };

  const clear = async () => {
    console.log('useRecentlyViewed: Clearing recently viewed properties');

    // Clear local state immediately for instant UI feedback
    clearAll();

    // Clear from database if authenticated
    if (oxyServices && activeSessionId) {
      try {
        await clearFromDatabase(oxyServices, activeSessionId);
      } catch (error) {
        console.error('useRecentlyViewed: Failed to clear from database:', error);
        // Revert local state if database clear failed
        await refetch();
      }
    }
  };

  const addProperty = async (property: Property) => {
    const propertyId = property._id || property.id;
    console.log('useRecentlyViewed: Adding property to recently viewed:', propertyId);

    if (propertyId) {
      // Add to local state immediately for instant UI feedback
      addItem(propertyId, RecentlyViewedType.PROPERTY, property);

      // Sync to database if authenticated
      if (oxyServices && activeSessionId) {
        try {
          await syncToDatabase(oxyServices, activeSessionId);
        } catch (error) {
          console.error('useRecentlyViewed: Failed to sync to database:', error);
        }
      }
    }
  };

  const removeProperty = async (propertyId: string) => {
    console.log('useRecentlyViewed: Removing property from recently viewed:', propertyId);

    // Remove from local state immediately for instant UI feedback
    removeItem(propertyId);

    // Note: Individual property removal from database would require a new API endpoint
    // For now, we'll rely on the backend tracking and the clear functionality
  };

  return {
    properties,
    isLoading,
    error,
    refetch,
    clear,
    addProperty,
    removeProperty,
    clearError,
  };
}
