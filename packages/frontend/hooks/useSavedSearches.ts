import { useCallback, useEffect, useRef } from 'react';
import { useSavedSearchesStore, useSavedSearchesSelectors } from '@/store/savedSearchesStore';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/utils/api';

export const useSavedSearches = (): {
  searches: any[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  lastSynced: any;
  fetchSavedSearches: () => Promise<void>;
  saveSearch: (
    name: string,
    query: string,
    filters?: any,
    notificationsEnabled?: boolean,
  ) => Promise<boolean>;
  deleteSavedSearch: (searchId: string, searchName?: string) => Promise<boolean>;
  updateSearch: (
    searchId: string,
    updates: { name?: string; query?: string; filters?: any; notificationsEnabled?: boolean },
  ) => Promise<boolean>;
  toggleNotifications: (searchId: string, enabled: boolean) => Promise<boolean>;
  searchExists: (name: string, query?: string) => boolean;
  getSearchById: (id: string) => any;
  hasSearches: boolean;
  isAuthenticated: boolean;
} => {
  const { t } = useTranslation();
  const { searches, isLoading, error } = useSavedSearchesSelectors();
  const {
    setSearches,
    addSearch,
    removeSearch,
    updateSearch: updateSearchAction,
    toggleNotifications: toggleNotificationsAction,
    setLoading,
    setError,
  } = useSavedSearchesStore();

  const hasFetchedRef = useRef(false);
  const queryClient = useQueryClient();

  // Save search mutation using React Query
  const saveSearchMutation = useMutation({
    mutationKey: ['saveSearch'],
    mutationFn: async (vars: {
      name: string;
      query: string;
      filters?: any;
      notificationsEnabled?: boolean;
    }) => {
      const response = await api.post('/me/saved-searches', {
        name: vars.name,
        query: vars.query,
        filters: vars.filters,
        notificationsEnabled: Boolean(vars.notificationsEnabled),
      });

      const s = (response as any).data?.search || (response as any).data || {};
      const normalized = {
        id: s.id || s._id,
        name: s.name || s.title || vars.name,
        query: s.query || s.search || vars.query,
        filters: s.filters || s.criteria || vars.filters,
        notifications:
          typeof s.notifications === 'boolean'
            ? s.notifications
            : Boolean(s.notificationsEnabled ?? s.emailNotifications ?? s.pushNotifications ?? false),
        createdAt: s.createdAt || s.created_at || new Date().toISOString(),
        updatedAt: s.updatedAt || s.updated_at || new Date().toISOString(),
      };
      return normalized;
    },
    onSuccess: async (normalized) => {
      addSearch(normalized as any);
      await queryClient.invalidateQueries({ queryKey: ['savedSearches'] });
      toast.success(`Search "${normalized.name}" saved successfully`);
    },
    onError: (error: any) => {
      if (error?.status === 409) {
        const message =
          typeof error?.response?.message === 'string'
            ? error.response.message
            : t('search.duplicateName');
        toast.error(message + '. ' + t('search.tryDifferentName'));
        setError(message);
        return;
      }
      const msg = (error && error.message) || 'Failed to save search';
      toast.error(msg);
      setError(msg);
    },
  });

  // Fetch saved searches via React Query and sync to Zustand
  const fetchSavedSearchesCallback = useCallback(async () => {

    try {
      setLoading(true);
      setError(null);

      const response = await queryClient.fetchQuery({
        queryKey: ['savedSearches'],
        queryFn: async () => api.get('/me/saved-searches'),
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 10,
      });

      const raw = response.data?.searches || response.data || [];
      const normalized = (Array.isArray(raw) ? raw : []).map((s: any) => ({
        id: s.id || s._id,
        name: s.name || s.title || '',
        query: s.query || s.search || '',
        filters: s.filters || s.criteria || undefined,
        notifications:
          typeof s.notifications === 'boolean'
            ? s.notifications
            : Boolean(s.notificationsEnabled ?? s.emailNotifications ?? s.pushNotifications ?? false),
        createdAt: s.createdAt || s.created_at || new Date().toISOString(),
        updatedAt: s.updatedAt || s.updated_at || new Date().toISOString(),
      }));

      setSearches(normalized);
    } catch (error: any) {
      console.error('Failed to fetch saved searches:', error);
      setError(error.message || 'Failed to fetch saved searches');
    } finally {
      setLoading(false);
    }
  }, [setSearches, setLoading, setError, queryClient]);

  // Save a new search using Zustand store
  const saveSearch = useCallback(
    async (name: string, query: string, filters?: any, notificationsEnabled: boolean = false) => {

      if (!name.trim() || !query.trim()) {
        toast.error('Search name and query are required');
        return false;
      }

      try {
        // Prevent obvious duplicates client-side
        const normalizedName = name.trim();
        const normalizedQuery = query.trim();
        const duplicateByName = searches.some(
          (s) => String(s.name).toLowerCase() === normalizedName.toLowerCase(),
        );
        const duplicateExact = searches.some(
          (s) =>
            String(s.name).toLowerCase() === normalizedName.toLowerCase() &&
            String(s.query).toLowerCase() === normalizedQuery.toLowerCase(),
        );
        if (duplicateExact) {
          toast.error(t('search.duplicateExact'));
          return false;
        }
        if (duplicateByName) {
          toast.error(t('search.duplicateName') + '. ' + t('search.tryDifferentName'));
          return false;
        }
        await saveSearchMutation.mutateAsync({
          name: normalizedName,
          query: normalizedQuery,
          filters,
          notificationsEnabled,
        });
        return true;
      } catch (error: any) {
        console.error('Failed to save search:', error);
        // onError already handled toast/error
        return false;
      }
    },
    [searches, t, saveSearchMutation],
  );

  // Delete a saved search using Zustand store
  const deleteSavedSearch = useCallback(
    async (searchId: string, searchName?: string) => {
      try {
        await api.delete(`/me/saved-searches/${searchId}`);

        // Remove from store
        removeSearch(searchId);

        // Invalidate cache
        await queryClient.invalidateQueries({ queryKey: ['savedSearches'] });

        toast.success(`Search ${searchName ? `"${searchName}"` : ''} deleted successfully`);
        return true;
      } catch (error: any) {
        console.error('Failed to delete search:', error);
        const errorMessage = error.message || 'Failed to delete search';
        toast.error(errorMessage);
        setError(errorMessage);
        return false;
      }
    },
    [removeSearch, setError, queryClient],
  );

  // Update a saved search using Zustand store
  const updateSearch = useCallback(
    async (
      searchId: string,
      updates: { name?: string; query?: string; filters?: any; notificationsEnabled?: boolean },
    ) => {
      try {
        await api.patch(`/me/saved-searches/${searchId}`, updates);

        // Update in store
        updateSearchAction(searchId, updates);

        await queryClient.invalidateQueries({ queryKey: ['savedSearches'] });

        toast.success('Search updated successfully');
        return true;
      } catch (error: any) {
        console.error('Failed to update search:', error);
        const errorMessage = error.message || 'Failed to update search';
        toast.error(errorMessage);
        setError(errorMessage);
        return false;
      }
    },
    [updateSearchAction, setError, queryClient],
  );

  // Toggle notifications for a search using Zustand store
  const toggleNotifications = useCallback(
    async (searchId: string, enabled: boolean) => {
      try {
        if (!searchId) {
          throw new Error('Invalid saved search');
        }
        await api.patch(`/me/saved-searches/${searchId}/notifications`, { enabled });

        // Toggle in store
        toggleNotificationsAction(searchId);

        await queryClient.invalidateQueries({ queryKey: ['savedSearches'] });

        toast.success(
          enabled ? t('search.enableNotifications') : t('search.disableNotifications')
        );
        return true;
      } catch (error: any) {
        console.error('Failed to toggle notifications:', error);
        const message =
          error && typeof error === 'object' && typeof (error as any).message === 'string'
            ? (error as any).message
            : 'Failed to update notifications';
        toast.error(message);
        setError(message);
        return false;
      }
    },
    [toggleNotificationsAction, setError, queryClient, t],
  );

  // Check if a search exists by name or query
  const searchExists = useCallback(
    (name: string, query?: string) => {
      return searches.some(
        (search) =>
          search.name.toLowerCase() === name.toLowerCase() ||
          (query && search.query.toLowerCase() === query.toLowerCase()),
      );
    },
    [searches],
  );

  // Get search by ID
  const getSearchById = useCallback(
    (searchId: string) => {
      return searches.find((search) => search.id === searchId);
    },
    [searches],
  );

  // Load saved searches on mount
  useEffect(() => {
    if (
      !hasFetchedRef.current &&
      searches.length === 0 &&
      !isLoading
    ) {
      hasFetchedRef.current = true;
      fetchSavedSearchesCallback();
    }
  }, [searches.length, isLoading, fetchSavedSearchesCallback]);

  return {
    // State
    searches,
    isLoading,
    isSaving: saveSearchMutation.isPending,
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
    isAuthenticated: true, // Authentication is now handled by the API layer
  };
};
