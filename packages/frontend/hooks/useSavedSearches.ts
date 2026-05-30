import { useCallback, useEffect, useRef } from 'react';
import {
  useSavedSearchesStore,
  useSavedSearchesSelectors,
  type SavedSearch,
  type SavedSearchFilters,
} from '@/store/savedSearchesStore';
import { toast } from '@/lib/sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '@/utils/api';

/**
 * A saved search as it can arrive from the backend. The API has historically
 * used a few different field names (e.g. `title` vs `name`, `_id` vs `id`,
 * `notificationsEnabled` vs `notifications`), so every field is optional here
 * and normalised into a canonical {@link SavedSearch} before use.
 */
interface RawSavedSearch {
  id?: string;
  _id?: string;
  name?: string;
  title?: string;
  query?: string;
  search?: string;
  filters?: SavedSearchFilters;
  criteria?: SavedSearchFilters;
  notifications?: boolean;
  notificationsEnabled?: boolean;
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

/**
 * Possible response envelopes for the saved-searches endpoints. Different
 * backend versions nest the payload differently, so the helpers below probe
 * each known shape.
 */
interface SavedSearchEnvelope {
  data?: RawSavedSearch | RawSavedSearch[] | { search?: RawSavedSearch };
  searches?: RawSavedSearch[];
  search?: RawSavedSearch;
}

/**
 * The endpoints may return either an envelope object or a bare array of
 * searches at the top level depending on the backend version.
 */
type SavedSearchPayload = SavedSearchEnvelope | RawSavedSearch[];

const isApiError = (error: unknown): error is ApiError =>
  error instanceof ApiError || (typeof error === 'object' && error !== null && 'status' in error);

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
};

/**
 * Pulls a single {@link RawSavedSearch} out of a (non-array) response envelope,
 * tolerating the `{ data }`, `{ data: { search } }` and `{ search }` shapes
 * different backend versions return.
 */
const extractSearch = (envelope: SavedSearchEnvelope): RawSavedSearch => {
  const nested = envelope.data;
  if (Array.isArray(nested)) return nested[0] ?? {};
  if (nested && typeof nested === 'object') {
    // `{ data: { search: {...} } }` — distinguish the nested object envelope
    // from a `RawSavedSearch` whose own `search` field is a query string.
    const innerSearch = (nested as { search?: unknown }).search;
    if (innerSearch && typeof innerSearch === 'object') {
      return innerSearch as RawSavedSearch;
    }
    return nested as RawSavedSearch;
  }
  return envelope.search ?? {};
};

const normalizeSearch = (raw: RawSavedSearch, defaults: Partial<SavedSearch> = {}): SavedSearch => ({
  id: raw.id ?? raw._id ?? defaults.id ?? '',
  name: raw.name ?? raw.title ?? defaults.name ?? '',
  query: raw.query ?? raw.search ?? defaults.query ?? '',
  filters: raw.filters ?? raw.criteria ?? defaults.filters,
  notifications:
    typeof raw.notifications === 'boolean'
      ? raw.notifications
      : Boolean(raw.notificationsEnabled ?? raw.emailNotifications ?? raw.pushNotifications ?? false),
  notificationsEnabled:
    typeof raw.notificationsEnabled === 'boolean'
      ? raw.notificationsEnabled
      : typeof raw.notifications === 'boolean'
        ? raw.notifications
        : false,
  createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
  updatedAt: raw.updatedAt ?? raw.updated_at ?? new Date().toISOString(),
});

export const useSavedSearches = (): {
  searches: SavedSearch[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  lastSynced: string | null;
  fetchSavedSearches: () => Promise<void>;
  saveSearch: (
    name: string,
    query: string,
    filters?: SavedSearchFilters,
    notificationsEnabled?: boolean,
  ) => Promise<boolean>;
  deleteSavedSearch: (searchId: string, searchName?: string) => Promise<boolean>;
  updateSearch: (
    searchId: string,
    updates: {
      name?: string;
      query?: string;
      filters?: SavedSearchFilters;
      notificationsEnabled?: boolean;
    },
  ) => Promise<boolean>;
  toggleNotifications: (searchId: string, enabled: boolean) => Promise<boolean>;
  searchExists: (name: string, query?: string) => boolean;
  getSearchById: (id: string) => SavedSearch | undefined;
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
      filters?: SavedSearchFilters;
      notificationsEnabled?: boolean;
    }): Promise<SavedSearch> => {
      const response = await api.post<SavedSearchPayload>('/api/profiles/me/saved-searches', {
        name: vars.name,
        query: vars.query,
        filters: vars.filters,
        notificationsEnabled: Boolean(vars.notificationsEnabled),
      });

      const payload = response.data;
      const raw = Array.isArray(payload) ? (payload[0] ?? {}) : extractSearch(payload);
      return normalizeSearch(raw, {
        name: vars.name,
        query: vars.query,
        filters: vars.filters,
      });
    },
    onSuccess: async (normalized) => {
      addSearch(normalized);
      await queryClient.invalidateQueries({ queryKey: ['savedSearches'] });
      toast.success(`Search "${normalized.name}" saved successfully`);
    },
    onError: (error: unknown) => {
      if (isApiError(error) && error.status === 409) {
        const responseMessage =
          error.response && typeof error.response.message === 'string'
            ? error.response.message
            : t('search.duplicateName');
        toast.error(responseMessage + '. ' + t('search.tryDifferentName'));
        setError(responseMessage);
        return;
      }
      const msg = getErrorMessage(error, 'Failed to save search');
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
        queryFn: async () => api.get<SavedSearchPayload>('/api/profiles/me/saved-searches'),
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 10,
      });

      const payload = response.data;
      let raw: RawSavedSearch[];
      if (Array.isArray(payload)) {
        raw = payload;
      } else {
        const nested = payload?.data;
        raw = Array.isArray(nested) ? nested : (payload?.searches ?? []);
      }
      const normalized = raw.map((s) => normalizeSearch(s));

      setSearches(normalized);
    } catch (error: unknown) {
      setError(getErrorMessage(error, 'Failed to fetch saved searches'));
    } finally {
      setLoading(false);
    }
  }, [setSearches, setLoading, setError, queryClient]);

  // Save a new search using Zustand store
  const saveSearch = useCallback(
    async (
      name: string,
      query: string,
      filters?: SavedSearchFilters,
      notificationsEnabled: boolean = false,
    ) => {

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
      } catch {
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
        await api.delete(`/api/profiles/me/saved-searches/${searchId}`);

        // Remove from store
        removeSearch(searchId);

        // Invalidate cache
        await queryClient.invalidateQueries({ queryKey: ['savedSearches'] });

        toast.success(`Search ${searchName ? `"${searchName}"` : ''} deleted successfully`);
        return true;
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error, 'Failed to delete search');
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
      updates: {
        name?: string;
        query?: string;
        filters?: SavedSearchFilters;
        notificationsEnabled?: boolean;
      },
    ) => {
      try {
        await api.put(`/api/profiles/me/saved-searches/${searchId}`, updates);

        // Update in store
        updateSearchAction(searchId, updates);

        await queryClient.invalidateQueries({ queryKey: ['savedSearches'] });

        toast.success('Search updated successfully');
        return true;
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error, 'Failed to update search');
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
        await api.put(`/api/profiles/me/saved-searches/${searchId}/notifications`, { enabled });

        // Toggle in store
        toggleNotificationsAction(searchId);

        await queryClient.invalidateQueries({ queryKey: ['savedSearches'] });

        toast.success(
          enabled ? t('search.enableNotifications') : t('search.disableNotifications')
        );
        return true;
      } catch (error: unknown) {
        const message = getErrorMessage(error, 'Failed to update notifications');
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
