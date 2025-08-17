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

  // Add property to recently viewed (local state + backend tracking)
  const addProperty = useCallback(async (property: Property) => {
    const propertyId = property._id || property.id;
    console.log('useRecentlyViewed: Adding property to recently viewed:', {
      propertyId,
      propertyTitle: (property as any).title || 'No title',
      propertyData: {
        _id: property._id,
        id: property.id,
        title: (property as any).title,
      }
    });

    if (!propertyId) {
      console.log('useRecentlyViewed: No property ID found, skipping');
      return;
    }

    // Add to local state immediately for instant UI feedback
    addItem(propertyId, RecentlyViewedType.PROPERTY, property);

    // Debug: Check local state after adding
    const currentLocalProperties = useRecentlyViewedStore.getState().items
      .filter((item) => item.type === RecentlyViewedType.PROPERTY)
      .map((item) => item.data)
      .slice(0, 10);
    
    console.log('useRecentlyViewed: After adding to local state:', {
      propertyId,
      localPropertiesCount: currentLocalProperties.length,
      localProperties: currentLocalProperties.map((p: any) => ({ id: p._id || p.id, title: (p as any).title || 'No title' })),
    });

    // No longer updating React Query cache to avoid race conditions
    // Local state is the single source of truth

    // Track view in backend if authenticated (but don't let it interfere with our cache)
    if (oxyServices && activeSessionId) {
      // Use a separate mutation that doesn't update the cache
      trackPropertyViewMutation.mutate(propertyId, {
        onError: (error) => {
          console.error('useRecentlyViewed: Failed to track property view:', error);
          // Don't show error toast here as the local state was updated successfully
        }
      });
    }
  }, [addItem, oxyServices, activeSessionId, trackPropertyViewMutation]);

  // Remove property from recently viewed (local state only)
  const removeProperty = useCallback(async (propertyId: string) => {
    console.log('useRecentlyViewed: Removing property from recently viewed:', propertyId);

    // Remove from local state immediately for instant UI feedback
    removeItem(propertyId);

    // No longer updating React Query cache to avoid race conditions

    // Note: Individual property removal from database would require a new API endpoint
    // For now, we'll rely on the backend tracking and the clear functionality
  }, [removeItem]);

  // Clear all recently viewed properties
  const clear = useCallback(async () => {
    console.log('useRecentlyViewed: Clearing recently viewed properties');

    // Clear local state immediately for instant UI feedback
    clearAll();

    // No longer updating React Query cache to avoid race conditions

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
  // Never fall back to React Query data to avoid race conditions
  const displayProperties = localProperties;

  // Debug logging - show first 3 properties in detail
  console.log('=== RECENTLY VIEWED DEBUG ===');
  console.log('Total properties:', localProperties.length);
  console.log('First property:', localProperties[0] ? {
    id: localProperties[0]._id || localProperties[0].id,
    title: (localProperties[0] as any).title || 'No title',
  } : 'None');
  console.log('Second property:', localProperties[1] ? {
    id: localProperties[1]._id || localProperties[1].id,
    title: (localProperties[1] as any).title || 'No title',
  } : 'None');
  console.log('Third property:', localProperties[2] ? {
    id: localProperties[2]._id || localProperties[2].id,
    title: (localProperties[2] as any).title || 'No title',
  } : 'None');
  console.log('All property IDs:', localProperties.map((p: any) => p._id || p.id));
  console.log('=== END DEBUG ===');

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
