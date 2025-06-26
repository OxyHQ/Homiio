import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/store/store';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
import { userApi } from '@/utils/api';
import type { Property } from '@/services/propertyService';
import { 
  saveProperty as savePropertyAction, 
  unsaveProperty as unsavePropertyAction,
  updatePropertyNotes as updateNotesAction,
  loadSavedProperties
} from '@/store/reducers/savedPropertiesReducer';

// Hook to get saved properties
export function useSavedProperties() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { properties, isLoading, error } = useSelector((state: RootState) => state.savedProperties);

  const refetch = useCallback(() => {
    if (oxyServices && activeSessionId) {
      dispatch(loadSavedProperties({ oxyServices, activeSessionId }));
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    properties,
    loading: isLoading,
    error,
    refetch,
  };
}

// Hook to save a property
export function useSaveProperty() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { isSaving } = useSelector((state: RootState) => state.savedProperties);

  const saveProperty = useCallback(async ({ propertyId, notes }: { propertyId: string; notes?: string }) => {
    console.log('Attempting to save property:', propertyId);
    
    // Check if OxyServices is available
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      const response = await userApi.saveProperty(propertyId, notes, oxyServices, activeSessionId);
      console.log('Save property success:', response);
      
      // Dispatch to Redux store
      dispatch(savePropertyAction({ propertyId, notes, oxyServices, activeSessionId }));
      
      // Show success toast
      toast.success('Property saved successfully!', {
        description: 'You can view it in your saved properties.',
        duration: 3000,
      });
      
      return response.data;
    } catch (error: any) {
      console.error('Save property error:', error);
      toast.error('Failed to save property', {
        description: error.message || 'Please try again.',
        duration: 4000,
      });
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    saveProperty,
    loading: isSaving,
  };
}

// Hook to unsave a property
export function useUnsaveProperty() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { isSaving } = useSelector((state: RootState) => state.savedProperties);

  const unsaveProperty = useCallback(async (propertyId: string) => {
    console.log('Attempting to unsave property:', propertyId);
    
    // Check if OxyServices is available
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      const response = await userApi.unsaveProperty(propertyId, oxyServices, activeSessionId);
      console.log('Unsave property success:', response);
      
      // Dispatch to Redux store
      dispatch(unsavePropertyAction({ propertyId, oxyServices, activeSessionId }));
      
      // Show success toast
      toast.success('Property removed from saved', {
        description: 'Property has been removed from your saved properties.',
        duration: 3000,
      });
      
      return response.data;
    } catch (error: any) {
      console.error('Unsave property error:', error);
      toast.error('Failed to remove property', {
        description: error.message || 'Please try again.',
        duration: 4000,
      });
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    unsaveProperty,
    loading: isSaving,
  };
}

// Hook to update saved property notes
export function useUpdateSavedPropertyNotes() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { isSaving } = useSelector((state: RootState) => state.savedProperties);

  const updateNotes = useCallback(async ({ propertyId, notes }: { propertyId: string; notes: string }) => {
    // Check if OxyServices is available
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      const response = await userApi.updateSavedPropertyNotes(propertyId, notes, oxyServices, activeSessionId);
      
      // Dispatch to Redux store
      dispatch(updateNotesAction({ propertyId, notes, oxyServices, activeSessionId }));
      
      return response.data;
    } catch (error) {
      console.error('Update saved property notes error:', error);
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    updateNotes,
    loading: isSaving,
  };
}

// Hook to get user's owned properties
export function useUserProperties() {
  const { oxyServices, activeSessionId } = useOxy();
  
  // For now, return a simple implementation that can be expanded later
  // This would need a separate Redux reducer for user properties
  const fetchUserProperties = useCallback(async (page = 1, limit = 10) => {
    // Check if OxyServices is available
    if (!oxyServices || !activeSessionId) {
      console.log('OxyServices not available - returning empty properties');
      return { properties: [], total: 0, page: 1, totalPages: 1 };
    }

    try {
      console.log('Fetching user properties with OxyServices authentication');
      
      const response = await userApi.getUserProperties(page, limit, oxyServices, activeSessionId);
      
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
  }, [oxyServices, activeSessionId]);

  return {
    fetchUserProperties,
    // Return empty state for now - this would be expanded with Redux state
    properties: [],
    total: 0,
    page: 1,
    totalPages: 1,
    loading: false,
  };
}
