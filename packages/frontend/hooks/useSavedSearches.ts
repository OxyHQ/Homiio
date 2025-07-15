import { useCallback, useEffect, useRef } from 'react';
import { useSavedSearchesStore, useSavedSearchesSelectors } from '@/store/savedSearchesStore';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';

export const useSavedSearches = () => {
  const { searches, isLoading, error } = useSavedSearchesSelectors();
  const { 
    setSearches, 
    addSearch, 
    removeSearch, 
    updateSearch: updateSearchAction, 
    toggleNotifications: toggleNotificationsAction,
    setLoading, 
    setError 
  } = useSavedSearchesStore();
  const { oxyServices, activeSessionId } = useOxy();
  const hasFetchedRef = useRef(false);

  // Fetch saved searches from backend using Zustand store
  const fetchSavedSearchesCallback = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      console.log('useSavedSearches: No authentication, skipping fetch');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { userApi } = await import('@/utils/api');
      const response = await userApi.getSavedSearches(oxyServices, activeSessionId);
      
      setSearches(response.data?.searches || response.data || []);
    } catch (error: any) {
      console.error('Failed to fetch saved searches:', error);
      setError(error.message || 'Failed to fetch saved searches');
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, setSearches, setLoading, setError]);

  // Save a new search using Zustand store
  const saveSearch = useCallback(async (
    name: string,
    query: string,
    filters?: any,
    notificationsEnabled: boolean = false
  ) => {
    if (!oxyServices || !activeSessionId) {
      toast.error('Please sign in to save searches');
      return false;
    }

    if (!name.trim() || !query.trim()) {
      toast.error('Search name and query are required');
      return false;
    }

    try {
      const searchData = {
        name: name.trim(),
        query: query.trim(),
        filters,
        notificationsEnabled,
      };

      // Import the API function
      const { userApi } = await import('@/utils/api');
      const response = await userApi.saveSearch(searchData, oxyServices, activeSessionId);
      
      // Add to store
      addSearch(response.data?.search || response.data);
      
      toast.success(`Search "${name}" saved successfully`);
      return true;
    } catch (error: any) {
      console.error('Failed to save search:', error);
      const errorMessage = error.message || 'Failed to save search';
      toast.error(errorMessage);
      setError(errorMessage);
      return false;
    }
  }, [oxyServices, activeSessionId, addSearch, setError]);

  // Delete a saved search using Zustand store
  const deleteSavedSearch = useCallback(async (searchId: string, searchName?: string) => {
    if (!oxyServices || !activeSessionId) {
      toast.error('Please sign in to manage searches');
      return false;
    }

    try {
      // Import the API function
      const { userApi } = await import('@/utils/api');
      await userApi.deleteSavedSearch(searchId, oxyServices, activeSessionId);
      
      // Remove from store
      removeSearch(searchId);
      
      toast.success(`Search ${searchName ? `"${searchName}"` : ''} deleted successfully`);
      return true;
    } catch (error: any) {
      console.error('Failed to delete search:', error);
      const errorMessage = error.message || 'Failed to delete search';
      toast.error(errorMessage);
      setError(errorMessage);
      return false;
    }
  }, [oxyServices, activeSessionId, removeSearch, setError]);

  // Update a saved search using Zustand store
  const updateSearch = useCallback(async (
    searchId: string,
    updates: { name?: string; query?: string; filters?: any; notificationsEnabled?: boolean }
  ) => {
    if (!oxyServices || !activeSessionId) {
      toast.error('Please sign in to update searches');
      return false;
    }

    try {
      // Import the API function
      const { userApi } = await import('@/utils/api');
      await userApi.updateSavedSearch(searchId, updates, oxyServices, activeSessionId);
      
      // Update in store
      updateSearchAction(searchId, updates);
      
      toast.success('Search updated successfully');
      return true;
    } catch (error: any) {
      console.error('Failed to update search:', error);
      const errorMessage = error.message || 'Failed to update search';
      toast.error(errorMessage);
      setError(errorMessage);
      return false;
    }
  }, [oxyServices, activeSessionId, updateSearchAction, setError]);

  // Toggle notifications for a search using Zustand store
  const toggleNotifications = useCallback(async (searchId: string, enabled: boolean) => {
    if (!oxyServices || !activeSessionId) {
      toast.error('Please sign in to manage notifications');
      return false;
    }

    try {
      // Import the API function
      const { userApi } = await import('@/utils/api');
      await userApi.toggleSearchNotifications(searchId, enabled, oxyServices, activeSessionId);
      
      // Toggle in store
      toggleNotificationsAction(searchId);
      
      toast.success(`Notifications ${enabled ? 'enabled' : 'disabled'} for search`);
      return true;
    } catch (error: any) {
      console.error('Failed to toggle notifications:', error);
      toast.error(error.message || 'Failed to update notifications');
      setError(error.message || 'Failed to update notifications');
      return false;
    }
  }, [oxyServices, activeSessionId, toggleNotificationsAction, setError]);

  // Check if a search exists by name or query
  const searchExists = useCallback((name: string, query?: string) => {
    return searches.some(search => 
      search.name.toLowerCase() === name.toLowerCase() || 
      (query && search.query.toLowerCase() === query.toLowerCase())
    );
  }, [searches]);

  // Get search by ID
  const getSearchById = useCallback((searchId: string) => {
    return searches.find(search => search.id === searchId);
  }, [searches]);

  // Load saved searches on mount or when auth changes
  useEffect(() => {
    if (oxyServices && activeSessionId && !hasFetchedRef.current && searches.length === 0 && !isLoading) {
      hasFetchedRef.current = true;
      fetchSavedSearchesCallback();
    }
  }, [oxyServices, activeSessionId, searches.length, isLoading, fetchSavedSearchesCallback]);

  // Reset fetch flag when auth changes
  useEffect(() => {
    if (!oxyServices || !activeSessionId) {
      hasFetchedRef.current = false;
    }
  }, [oxyServices, activeSessionId]);

  return {
    // State
    searches,
    isLoading,
    isSaving: false, // Not implemented in Zustand store yet
    error,
    lastSynced: null, // Not implemented in Zustand store yet
    
    // Actions
    fetchSavedSearches: fetchSavedSearchesCallback,
    saveSearch,
    deleteSavedSearch,
    updateSearch,
    toggleNotifications,
    
    // Utilities
    searchExists,
    getSearchById,
    
    // Computed
    hasSearches: searches.length > 0,
    isAuthenticated: !!oxyServices && !!activeSessionId,
  };
}; 