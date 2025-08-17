import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';
import { useOxy } from '@oxyhq/services';
import type { Property } from '@homiio/shared-types';
import { RecentlyViewedType } from '@homiio/shared-types';
import { useCallback } from 'react';
import { 
  useRecentlyViewedProperties, 
  useTrackPropertyView, 
  useClearRecentlyViewed 
} from './useRecentlyViewedQueries';

export function useRecentlyViewed() {
  const {
    addItem,
    removeItem,
    clearAll,
    getRecentProperties,
    setError,
    clearError,
  } = useRecentlyViewedStore();
  const { oxyServices, activeSessionId } = useOxy();

  // React Query hooks
  const {
    data: properties = [],
    isLoading,
    error,
    refetch,
  } = useRecentlyViewedProperties();

  const trackPropertyViewMutation = useTrackPropertyView();
  const clearRecentlyViewedMutation = useClearRecentlyViewed();

  // Add property to recently viewed (local state + backend tracking)
  const addProperty = useCallback(async (property: Property) => {
    const propertyId = property._id || property.id;
    console.log('useRecentlyViewed: Adding property to recently viewed:', propertyId);

    if (!propertyId) return;

    // Add to local state immediately for instant UI feedback
    addItem(propertyId, RecentlyViewedType.PROPERTY, property);

    // Track view in backend if authenticated
    if (oxyServices && activeSessionId) {
      try {
        await trackPropertyViewMutation.mutateAsync(propertyId);
      } catch (error) {
        console.error('useRecentlyViewed: Failed to track property view:', error);
        // Don't show error toast here as the local state was updated successfully
      }
    }
  }, [addItem, oxyServices, activeSessionId, trackPropertyViewMutation]);

  // Remove property from recently viewed (local state only)
  const removeProperty = useCallback(async (propertyId: string) => {
    console.log('useRecentlyViewed: Removing property from recently viewed:', propertyId);

    // Remove from local state immediately for instant UI feedback
    removeItem(propertyId);

    // Note: Individual property removal from database would require a new API endpoint
    // For now, we'll rely on the backend tracking and the clear functionality
  }, [removeItem]);

  // Clear all recently viewed properties
  const clear = useCallback(async () => {
    console.log('useRecentlyViewed: Clearing recently viewed properties');

    // Clear local state immediately for instant UI feedback
    clearAll();

    // Clear from database if authenticated
    if (oxyServices && activeSessionId) {
      try {
        await clearRecentlyViewedMutation.mutateAsync();
      } catch (error) {
        console.error('useRecentlyViewed: Failed to clear from database:', error);
        // Revert local state if database clear failed
        await refetch();
      }
    }
  }, [clearAll, oxyServices, activeSessionId, clearRecentlyViewedMutation, refetch]);

  // Get properties from local state (for immediate UI updates)
  const localProperties = getRecentProperties();

  // Use query data if available, otherwise fall back to local state
  const displayProperties = properties.length > 0 ? properties : localProperties;

  return {
    properties: displayProperties,
    isLoading: isLoading || trackPropertyViewMutation.isPending || clearRecentlyViewedMutation.isPending,
    error: error?.message || null,
    refetch,
    clear,
    addProperty,
    removeProperty,
    clearError,
  };
}
