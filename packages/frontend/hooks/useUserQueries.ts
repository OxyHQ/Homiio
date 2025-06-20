import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userService } from '@/services/userService';
import type { Property } from '@/services/propertyService';
import { useOxy } from '@oxyhq/services';
import { API_URL } from '@/config';

export const userKeys = {
  recentProperties: () => ['user', 'recent-properties'] as const,
};

// OxyServices-based recently viewed properties hook
export function useRecentlyViewedProperties() {
  const { oxyServices, activeSessionId } = useOxy();
  
  return useQuery<Property[]>({
    queryKey: userKeys.recentProperties(),
    queryFn: async () => {
      // Check if OxyServices is available
      if (!oxyServices || !activeSessionId) {
        console.log('OxyServices not available - returning empty array');
        return [];
      }

      try {
        console.log('Fetching recent properties with OxyServices authentication');
        
        // Get the token from OxyServices
        const tokenData = await oxyServices.getTokenBySession(activeSessionId);
        
        if (!tokenData) {
          console.log('No token available from OxyServices');
          return [];
        }

        // Make authenticated request
        const response = await fetch(`${API_URL}/api/users/me/recent-properties`, {
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            console.log('Authentication failed for recent properties');
            return [];
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const properties = data.data || [];
        console.log(`Successfully fetched ${properties.length} recent properties`);
        return properties;
      } catch (error) {
        console.error('Error fetching recent properties:', error);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!(oxyServices && activeSessionId), // Only run when authenticated
  });
}

// Hook to track property views and invalidate cache
export function useTrackPropertyView() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async (propertyId: string) => {
      // Check if OxyServices is available
      if (!oxyServices || !activeSessionId) {
        console.log('OxyServices not available - skipping property view tracking');
        return;
      }

      try {
        // Get the token from OxyServices
        const tokenData = await oxyServices.getTokenBySession(activeSessionId);
        
        if (!tokenData) {
          console.log('No token available from OxyServices - skipping property view tracking');
          return;
        }

        // Make a request to view the property (this will trigger the backend to track it)
        const response = await fetch(`${API_URL}/api/properties/${propertyId}`, {
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          console.log('Failed to track property view:', response.status);
          return;
        }

        console.log(`Successfully tracked view for property ${propertyId}`);
      } catch (error) {
        console.error('Error tracking property view:', error);
      }
    },
    onSuccess: () => {
      // Invalidate the recently viewed properties cache to trigger a refresh
      queryClient.invalidateQueries({ queryKey: userKeys.recentProperties() });
      console.log('Invalidated recently viewed properties cache');
    },
  });
}
