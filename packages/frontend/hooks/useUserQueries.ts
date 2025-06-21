import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userService } from '@/services/userService';
import type { Property } from '@/services/propertyService';
import { useOxy } from '@oxyhq/services';
import { API_URL } from '@/config';
import { toast } from 'sonner';

export const userKeys = {
  recentProperties: () => ['user', 'recent-properties'] as const,
  savedProperties: () => ['user', 'saved-properties'] as const,
  userProperties: () => ['user', 'properties'] as const,
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

// OxyServices-based saved properties hook
export function useSavedProperties() {
  const { oxyServices, activeSessionId } = useOxy();
  
  console.log('useSavedProperties hook - OxyServices:', !!oxyServices, 'ActiveSessionId:', !!activeSessionId);
  
  return useQuery<Property[]>({
    queryKey: userKeys.savedProperties(),
    queryFn: async () => {
      // Check if OxyServices is available
      if (!oxyServices || !activeSessionId) {
        console.log('OxyServices not available - returning empty array');
        return [];
      }

      try {
        console.log('Fetching saved properties with OxyServices authentication');
        
        // Get the token from OxyServices
        const tokenData = await oxyServices.getTokenBySession(activeSessionId);
        
        if (!tokenData) {
          console.log('No token available from OxyServices');
          return [];
        }

        console.log('Got token from OxyServices, making API request');

        // Make authenticated request
        const response = await fetch(`${API_URL}/api/users/me/saved-properties`, {
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        console.log('Saved properties API response status:', response.status);

        if (!response.ok) {
          if (response.status === 401) {
            console.log('Authentication failed for saved properties');
            return [];
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const properties = data.data || [];
        console.log(`Successfully fetched ${properties.length} saved properties:`, properties);
        return properties;
      } catch (error) {
        console.error('Error fetching saved properties:', error);
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

// Hook to save a property
export function useSaveProperty() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async ({ propertyId, notes }: { propertyId: string; notes?: string }) => {
      console.log('Attempting to save property:', propertyId);
      
      // Check if OxyServices is available
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      // Get the token from OxyServices
      const tokenData = await oxyServices.getTokenBySession(activeSessionId);
      
      if (!tokenData) {
        throw new Error('No token available from OxyServices');
      }

      // Make authenticated request to save property
      const response = await fetch(`${API_URL}/api/users/me/saved-properties`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ propertyId, notes }),
      });

      console.log('Save property response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Save property error:', errorData);
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Save property success:', data);
      return data.data;
    },
    onMutate: async ({ propertyId, notes }) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: userKeys.savedProperties() });

      // Snapshot the previous value
      const previousSavedProperties = queryClient.getQueryData(userKeys.savedProperties());

      // Optimistically update to the new value
      queryClient.setQueryData(userKeys.savedProperties(), (old: Property[] = []) => {
        // Check if property is already in the list
        const existingIndex = old.findIndex(p => p._id === propertyId || p.id === propertyId);
        if (existingIndex >= 0) {
          // Property already exists, don't add it again
          return old;
        }
        
        // Add the property to the saved list with minimal required data
        const optimisticProperty = {
          _id: propertyId,
          id: propertyId,
          title: 'Loading...', // Placeholder, will be updated when we refetch
          address: { street: '', city: '', state: '', zipCode: '', country: '' },
          type: 'apartment' as const,
          rent: { amount: 0, currency: 'USD', paymentFrequency: 'monthly' as const, deposit: 0, utilities: 'excluded' as const },
          status: 'available' as const,
          ownerId: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          savedAt: new Date().toISOString(),
          notes: notes || '',
        } as Property;
        
        return [...old, optimisticProperty];
      });

      // Return a context object with the snapshotted value
      return { previousSavedProperties };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousSavedProperties) {
        queryClient.setQueryData(userKeys.savedProperties(), context.previousSavedProperties);
      }
      console.error('Save property mutation error:', err);
      toast.error('Failed to save property', {
        description: err.message || 'Please try again.',
        duration: 4000,
      });
    },
    onSuccess: (data) => {
      console.log('Save property mutation succeeded:', data);
      // Invalidate the saved properties cache to trigger a refresh
      queryClient.invalidateQueries({ queryKey: userKeys.savedProperties() });
      console.log('Invalidated saved properties cache');
      
      // Show success toast
      toast.success('Property saved successfully!', {
        description: 'You can view it in your saved properties.',
        duration: 3000,
      });
    },
    onSettled: () => {
      // Always refetch after error or success to ensure we have the latest data
      queryClient.invalidateQueries({ queryKey: userKeys.savedProperties() });
    },
  });
}

// Hook to unsave a property
export function useUnsaveProperty() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async (propertyId: string) => {
      console.log('Attempting to unsave property:', propertyId);
      
      // Check if OxyServices is available
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      // Get the token from OxyServices
      const tokenData = await oxyServices.getTokenBySession(activeSessionId);
      
      if (!tokenData) {
        throw new Error('No token available from OxyServices');
      }

      // Make authenticated request to unsave property
      const response = await fetch(`${API_URL}/api/users/me/saved-properties/${propertyId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${tokenData.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('Unsave property response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Unsave property error:', errorData);
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Unsave property success:', data);
      return data.data;
    },
    onMutate: async (propertyId) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: userKeys.savedProperties() });

      // Snapshot the previous value
      const previousSavedProperties = queryClient.getQueryData(userKeys.savedProperties());

      // Optimistically update to the new value
      queryClient.setQueryData(userKeys.savedProperties(), (old: Property[] = []) => {
        // Remove the property from the saved list
        return old.filter(p => p._id !== propertyId && p.id !== propertyId);
      });

      // Return a context object with the snapshotted value
      return { previousSavedProperties };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousSavedProperties) {
        queryClient.setQueryData(userKeys.savedProperties(), context.previousSavedProperties);
      }
      console.error('Unsave property mutation error:', err);
      toast.error('Failed to remove property', {
        description: err.message || 'Please try again.',
        duration: 4000,
      });
    },
    onSuccess: (data) => {
      console.log('Unsave property mutation succeeded:', data);
      // Invalidate the saved properties cache to trigger a refresh
      queryClient.invalidateQueries({ queryKey: userKeys.savedProperties() });
      console.log('Invalidated saved properties cache');
      
      // Show success toast
      toast.success('Property removed from saved', {
        description: 'Property has been removed from your saved properties.',
        duration: 3000,
      });
    },
    onSettled: () => {
      // Always refetch after error or success to ensure we have the latest data
      queryClient.invalidateQueries({ queryKey: userKeys.savedProperties() });
    },
  });
}

// Hook to update saved property notes
export function useUpdateSavedPropertyNotes() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async ({ propertyId, notes }: { propertyId: string; notes: string }) => {
      // Check if OxyServices is available
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      // Get the token from OxyServices
      const tokenData = await oxyServices.getTokenBySession(activeSessionId);
      
      if (!tokenData) {
        throw new Error('No token available from OxyServices');
      }

      // Make authenticated request to update notes
      const response = await fetch(`${API_URL}/api/users/me/saved-properties/${propertyId}/notes`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${tokenData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notes }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;
    },
    onSuccess: () => {
      // Invalidate the saved properties cache to trigger a refresh
      queryClient.invalidateQueries({ queryKey: userKeys.savedProperties() });
      console.log('Invalidated saved properties cache');
    },
  });
}

// Hook to get user's owned properties
export function useUserProperties() {
  const { oxyServices, activeSessionId } = useOxy();
  
  return useQuery<{
    properties: Property[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: userKeys.userProperties(),
    queryFn: async () => {
      // Check if OxyServices is available
      if (!oxyServices || !activeSessionId) {
        console.log('OxyServices not available - returning empty properties');
        return { properties: [], total: 0, page: 1, totalPages: 1 };
      }

      try {
        console.log('Fetching user properties with OxyServices authentication');
        
        // Get the token from OxyServices
        const tokenData = await oxyServices.getTokenBySession(activeSessionId);
        
        if (!tokenData) {
          console.log('No token available from OxyServices');
          return { properties: [], total: 0, page: 1, totalPages: 1 };
        }

        // Make authenticated request
        const response = await fetch(`${API_URL}/api/users/me/properties`, {
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            console.log('Authentication failed for user properties');
            return { properties: [], total: 0, page: 1, totalPages: 1 };
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const result = {
          properties: data.data || [],
          total: data.pagination?.total || 0,
          page: data.pagination?.page || 1,
          totalPages: data.pagination?.totalPages || 1,
        };
        console.log(`Successfully fetched ${result.properties.length} user properties`);
        return result;
      } catch (error) {
        console.error('Error fetching user properties:', error);
        return { properties: [], total: 0, page: 1, totalPages: 1 };
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!(oxyServices && activeSessionId), // Only run when authenticated
  });
}
