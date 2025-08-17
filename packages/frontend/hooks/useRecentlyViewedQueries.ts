import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { recentlyViewedService } from '@/services/recentlyViewedService';
import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';
import { RecentlyViewedType } from '@homiio/shared-types';
import { toast } from 'sonner';

/**
 * Hook for fetching recently viewed properties
 */
export const useRecentlyViewedProperties = () => {
  const { oxyServices, activeSessionId } = useOxy();

  return useQuery({
    queryKey: ['recentlyViewed', 'properties'],
    queryFn: async () => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required');
      }
      
      console.log('useRecentlyViewedProperties: Fetching from database');
      const response = await recentlyViewedService.getRecentlyViewedProperties(oxyServices, activeSessionId);
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch recently viewed properties');
      }
      
      // Transform database response to store format
      const items = (response.data || []).map((property: any) => ({
        id: property._id || property.id,
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
      
      console.log(`useRecentlyViewedProperties: Loaded ${items.length} items from database`);
      return response.data || [];
    },
    enabled: Boolean(oxyServices && activeSessionId),
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 2,
    onError: (error: any) => {
      console.error('useRecentlyViewedProperties: Error fetching from database:', error);
      useRecentlyViewedStore.getState().setError(error.message || 'Failed to load recently viewed properties');
    },
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
      
      const response = await recentlyViewedService.trackPropertyView(propertyId, oxyServices, activeSessionId);
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to track property view');
      }
      
      return response;
    },
    onSuccess: async () => {
      // Invalidate and refetch recently viewed properties
      await queryClient.invalidateQueries({ queryKey: ['recentlyViewed', 'properties'] });
    },
    onError: (error: any) => {
      console.error('Error tracking property view:', error);
      toast.error('Failed to track property view');
    },
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
      
      const response = await recentlyViewedService.clearRecentlyViewedProperties(oxyServices, activeSessionId);
      
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
      toast.success('Recently viewed properties cleared');
    },
    onError: (error: any) => {
      console.error('Error clearing recently viewed properties:', error);
      toast.error('Failed to clear recently viewed properties');
    },
  });
};
