import { useCallback, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
import type { RootState, AppDispatch } from '@/store/store';
import {
  SavedSearch,
  fetchSavedSearches,
  saveSavedSearch,
  deleteSavedSearchAsync,
  updateSavedSearchAsync,
  toggleSavedSearchNotifications,
  addSavedSearch,
  removeSavedSearch,
  updateSavedSearch,
  toggleSearchNotifications,
  setError,
} from '@/store/reducers/savedSearchesReducer';

export const useSavedSearches = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const hasFetchedRef = useRef(false);
  
  const {
    searches,
    isLoading,
    isSaving,
    error,
    lastSynced,
  } = useSelector((state: RootState) => state.savedSearches);

  // Fetch saved searches from backend using Redux action
  const fetchSavedSearchesCallback = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      console.log('useSavedSearches: No authentication, skipping fetch');
      return;
    }

    try {
      await dispatch(fetchSavedSearches({ oxyServices, activeSessionId })).unwrap();
    } catch (error: any) {
      console.error('Failed to fetch saved searches:', error);
      // Error is already handled in Redux reducer
    }
  }, [oxyServices, activeSessionId, dispatch]);

  // Save a new search using Redux action
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

      await dispatch(saveSavedSearch({ searchData, oxyServices, activeSessionId })).unwrap();
      toast.success(`Search "${name}" saved successfully`);
      return true;
    } catch (error: any) {
      console.error('Failed to save search:', error);
      const errorMessage = error.message || 'Failed to save search';
      toast.error(errorMessage);
      return false;
    }
  }, [oxyServices, activeSessionId, dispatch]);

  // Delete a saved search using Redux action
  const deleteSavedSearch = useCallback(async (searchId: string, searchName?: string) => {
    if (!oxyServices || !activeSessionId) {
      toast.error('Please sign in to manage searches');
      return false;
    }

    try {
      await dispatch(deleteSavedSearchAsync({ searchId, oxyServices, activeSessionId })).unwrap();
      toast.success(`Search ${searchName ? `"${searchName}"` : ''} deleted successfully`);
      return true;
    } catch (error: any) {
      console.error('Failed to delete search:', error);
      const errorMessage = error.message || 'Failed to delete search';
      toast.error(errorMessage);
      return false;
    }
  }, [oxyServices, activeSessionId, dispatch]);

  // Update a saved search using Redux action
  const updateSearch = useCallback(async (
    searchId: string,
    updates: { name?: string; query?: string; filters?: any; notificationsEnabled?: boolean }
  ) => {
    if (!oxyServices || !activeSessionId) {
      toast.error('Please sign in to update searches');
      return false;
    }

    try {
      await dispatch(updateSavedSearchAsync({ searchId, searchData: updates, oxyServices, activeSessionId })).unwrap();
      toast.success('Search updated successfully');
      return true;
    } catch (error: any) {
      console.error('Failed to update search:', error);
      const errorMessage = error.message || 'Failed to update search';
      toast.error(errorMessage);
      return false;
    }
  }, [oxyServices, activeSessionId, dispatch]);

  // Toggle notifications for a search using Redux action
  const toggleNotifications = useCallback(async (searchId: string, enabled: boolean) => {
    if (!oxyServices || !activeSessionId) {
      toast.error('Please sign in to manage notifications');
      return false;
    }

    try {
      await dispatch(toggleSavedSearchNotifications({ searchId, oxyServices, activeSessionId })).unwrap();
      toast.success(`Notifications ${enabled ? 'enabled' : 'disabled'} for search`);
      return true;
    } catch (error: any) {
      console.error('Failed to toggle notifications:', error);
      toast.error(error.message || 'Failed to update notifications');
      return false;
    }
  }, [oxyServices, activeSessionId, dispatch]);

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
    isSaving,
    error,
    lastSynced,
    
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