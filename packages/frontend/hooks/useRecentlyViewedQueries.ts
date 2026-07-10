import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { recentlyViewedService } from '@/services/recentlyViewedService';
import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';
import { RecentlyViewedType, Property } from '@homiio/shared-types';
import { toast } from '@/lib/sonner';
import i18next from 'i18next';

/**
 * Hook for fetching recently viewed properties
 */
export const useRecentlyViewedProperties = () => {
  const { oxyServices, activeSessionId } = useOxy();

  return useQuery<Property[]>({
    queryKey: ['recentlyViewed', 'properties'],
    queryFn: async (): Promise<Property[]> => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required');
      }

      try {
        const response = await recentlyViewedService.getRecentlyViewedProperties();

        if (!response.success) {
          throw new Error(response.error || 'Failed to fetch recently viewed properties');
        }

        // Only update store if it's empty (initial load)
        const currentItems = useRecentlyViewedStore.getState().items;
        if (currentItems.length === 0) {
          // Transform database response to store format. The backend augments
          // each property with a `viewedAt` timestamp that is not part of the
          // base Property type.
          const items = (response.data || []).map((property: Property & { viewedAt?: string }) => ({
            id: property._id || property.id || '',
            type: RecentlyViewedType.PROPERTY,
            data: property,
            viewedAt: property.viewedAt || new Date().toISOString(),
          }));

          // Update store with fetched data
          useRecentlyViewedStore.setState({
            items,
            isInitialized: true,
            isLoading: false,
            error: null,
          });
        }

        return response.data || [];
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load recently viewed properties';
        useRecentlyViewedStore.getState().setError(message);
        throw error;
      }
    },
    enabled: Boolean(oxyServices && activeSessionId),
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 2,
  });
};

/**
 * Hook for tracking property views
 */
export const useTrackPropertyView = () => {
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['recentlyViewed', 'trackView'],
    mutationFn: async (propertyId: string) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required');
      }
      
      const response = await recentlyViewedService.trackPropertyView(propertyId);
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to track property view');
      }
      
      return response;
    },
    // No optimistic updates - let the main hook handle all cache updates
    onError: (err, propertyId) => {
      toast.error(i18next.t('recentlyViewed.trackFailed'));
    },
    // No onSettled callback to avoid interfering with local cache updates
  });
};

/**
 * Hook for clearing recently viewed properties
 */
export const useClearRecentlyViewed = () => {
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['recentlyViewed', 'clear'],
    mutationFn: async () => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required');
      }
      
      const response = await recentlyViewedService.clearRecentlyViewedProperties();
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to clear recently viewed properties');
      }
      
      return response;
    },
    onSuccess: async () => {
      // Clear local state immediately for instant UI feedback
      useRecentlyViewedStore.getState().clearAll();
      
      // Invalidate queries
      await queryClient.invalidateQueries({ queryKey: ['recentlyViewed', 'properties'] });
      toast.success(i18next.t('recentlyViewed.clearSuccess'));
    },
    onError: () => {
      toast.error(i18next.t('recentlyViewed.clearFailed'));
    },
  });
};
