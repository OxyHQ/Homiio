import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';
import { useOxy } from '@oxyhq/services';
import type { Property } from '@homiio/shared-types';
import { RecentlyViewedType } from '@homiio/shared-types';
import { useCallback, useMemo } from 'react';
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
    setError,
    clearError,
  } = useRecentlyViewedStore();
  const { oxyServices, activeSessionId } = useOxy();

  // React Query hooks - only fetch if we don't have local data
  const {
    data: properties = [],
    isLoading,
    error,
    refetch,
  } = useRecentlyViewedProperties();

  const trackPropertyViewMutation = useTrackPropertyView();
  const clearRecentlyViewedMutation = useClearRecentlyViewed();

  // Add property to recently viewed
  const addProperty = useCallback(async (property: Property) => {
    const propertyId = property._id || property.id;

    if (!propertyId) return;

    // Add to local state immediately for instant UI feedback
    addItem(propertyId, RecentlyViewedType.PROPERTY, property);

    // Track view in backend if authenticated
    if (oxyServices && activeSessionId) {
      trackPropertyViewMutation.mutate(propertyId, {
        onError: (error) => {
          console.error('useRecentlyViewed: Failed to track property view:', error);
        }
      });
    }
  }, [addItem, oxyServices, activeSessionId, trackPropertyViewMutation]);

  // Remove property from recently viewed
  const removeProperty = useCallback(async (propertyId: string) => {
    removeItem(propertyId);
  }, [removeItem]);

  // Clear all recently viewed properties
  const clear = useCallback(async () => {
    clearAll();

    if (oxyServices && activeSessionId) {
      try {
        await clearRecentlyViewedMutation.mutateAsync();
      } catch (error) {
        console.error('useRecentlyViewed: Failed to clear from database:', error);
        await refetch();
      }
    }
  }, [clearAll, oxyServices, activeSessionId, clearRecentlyViewedMutation, refetch]);

  // Subscribe to items array directly to avoid infinite loops
  const items = useRecentlyViewedStore((state) => state.items);
  
  // Process items to get properties
  const localProperties = useMemo(() => {
    return items
      .filter((item) => item.type === RecentlyViewedType.PROPERTY)
      .map((item) => item.data)
      .slice(0, 10);
  }, [items]);

  // Always use local state as the source of truth for instant updates
  const displayProperties = localProperties;

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
