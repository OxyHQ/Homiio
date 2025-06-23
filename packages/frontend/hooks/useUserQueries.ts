import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi } from '@/utils/api';
import type { Property } from '@/services/propertyService';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';

export const userKeys = {
  savedProperties: () => ['user', 'saved-properties'] as const,
  userProperties: () => ['user', 'properties'] as const,
};

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
        
        const response = await userApi.getSavedProperties(oxyServices, activeSessionId);
        const properties = response.data || [];
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
        await userApi.trackPropertyView(propertyId, oxyServices, activeSessionId);
        console.log(`Successfully tracked view for property ${propertyId}`);
      } catch (error) {
        console.error('Error tracking property view:', error);
      }
    },
    onSuccess: () => {
      // Note: We no longer invalidate recently viewed cache here since we're using Redux
      console.log('Property view tracked successfully');
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

      try {
        const response = await userApi.saveProperty(propertyId, notes, oxyServices, activeSessionId);
        console.log('Save property success:', response);
        return response.data;
      } catch (error) {
        console.error('Save property error:', error);
        throw error;
      }
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

      try {
        const response = await userApi.unsaveProperty(propertyId, oxyServices, activeSessionId);
        console.log('Unsave property success:', response);
        return response.data;
      } catch (error) {
        console.error('Unsave property error:', error);
        throw error;
      }
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

      try {
        const response = await userApi.updateSavedPropertyNotes(propertyId, notes, oxyServices, activeSessionId);
        return response.data;
      } catch (error) {
        console.error('Update saved property notes error:', error);
        throw error;
      }
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
        
        const response = await userApi.getUserProperties(1, 10, oxyServices, activeSessionId);
        
        // The API response should contain the properties and pagination info in the data field
        const result = {
          properties: response.data?.properties || response.data || [],
          total: response.data?.total || 0,
          page: response.data?.page || 1,
          totalPages: response.data?.totalPages || 1,
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
