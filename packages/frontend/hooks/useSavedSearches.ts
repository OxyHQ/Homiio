import { useCallback, useMemo } from 'react';
import {
  type SavedSearch,
  type SavedSearchFilters,
} from '@/store/savedSearchesStore';
import { toast } from '@/lib/sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useOxy } from '@oxyhq/services';
import { api, ApiError } from '@/utils/api';

/**
 * Stable React Query key for the authenticated user's saved searches. Mutations
 * write the freshly-returned server object back to this cache, so the list and
 * every widget reading it stay in sync without a refetch flash.
 */
const SAVED_SEARCHES_KEY = ['savedSearches'] as const;

/** Stable empty-list reference for the logged-out / not-yet-loaded state. */
const EMPTY_SEARCHES: SavedSearch[] = [];

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

/** Pulls the list of raw searches out of any known list-response envelope. */
const extractSearchList = (payload: SavedSearchPayload): RawSavedSearch[] => {
  if (Array.isArray(payload)) return payload;
  const nested = payload?.data;
  if (Array.isArray(nested)) return nested;
  return payload?.searches ?? [];
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

export interface UseSavedSearches {
  searches: SavedSearch[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
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
}

export const useSavedSearches = (): UseSavedSearches => {
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();
  const queryClient = useQueryClient();

  /**
   * The single source of truth for the user's saved searches. Gated on
   * `isAuthenticated` so a logged-out client never fires the request (the route
   * sits behind `oxy.auth()` and `utils/api.ts` sends no `Authorization` header
   * when there is no token, which would otherwise 401-spam).
   */
  const listQuery = useQuery({
    queryKey: SAVED_SEARCHES_KEY,
    enabled: isAuthenticated,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
    queryFn: async (): Promise<SavedSearch[]> => {
      const response = await api.get<SavedSearchPayload>('/api/profiles/me/saved-searches');
      return extractSearchList(response.data).map((raw) => normalizeSearch(raw));
    },
  });

  // When logged out the query is disabled and never resolves, so fall back to a
  // stable empty list rather than leaving `searches` undefined. Memoised on the
  // query data so consumers' `useCallback`/`useMemo` deps stay referentially
  // stable across renders where the data is unchanged.
  const searches = useMemo<SavedSearch[]>(() => listQuery.data ?? EMPTY_SEARCHES, [listQuery.data]);

  /** Replace a single search in the cached list by id, or append if new. */
  const upsertCachedSearch = useCallback(
    (next: SavedSearch) => {
      queryClient.setQueryData<SavedSearch[]>(SAVED_SEARCHES_KEY, (prev) => {
        const list = prev ?? [];
        const index = list.findIndex((s) => s.id === next.id);
        if (index === -1) return [...list, next];
        const copy = list.slice();
        copy[index] = next;
        return copy;
      });
    },
    [queryClient],
  );

  /** Remove a single search from the cached list by id. */
  const removeCachedSearch = useCallback(
    (searchId: string) => {
      queryClient.setQueryData<SavedSearch[]>(SAVED_SEARCHES_KEY, (prev) =>
        (prev ?? []).filter((s) => s.id !== searchId),
      );
    },
    [queryClient],
  );

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
    onSuccess: (saved) => {
      upsertCachedSearch(saved);
      toast.success(t('search.widgets.savedSearches.saveSuccess', { name: saved.name }));
    },
    onError: (error: unknown) => {
      if (isApiError(error) && error.status === 409) {
        const response =
          error.response && typeof error.response === 'object'
            ? (error.response as { message?: unknown })
            : undefined;
        const responseMessage =
          typeof response?.message === 'string'
            ? response.message
            : t('search.duplicateName');
        toast.error(responseMessage + '. ' + t('search.tryDifferentName'));
        return;
      }
      toast.error(getErrorMessage(error, t('search.widgets.savedSearches.saveFailed')));
    },
  });

  const updateSearchMutation = useMutation({
    mutationKey: ['updateSearch'],
    mutationFn: async (vars: {
      searchId: string;
      updates: {
        name?: string;
        query?: string;
        filters?: SavedSearchFilters;
        notificationsEnabled?: boolean;
      };
    }): Promise<SavedSearch> => {
      const response = await api.put<SavedSearchPayload>(
        `/api/profiles/me/saved-searches/${vars.searchId}`,
        vars.updates,
      );
      const payload = response.data;
      const raw = Array.isArray(payload) ? (payload[0] ?? {}) : extractSearch(payload);
      return normalizeSearch(raw, {
        id: vars.searchId,
        name: vars.updates.name,
        query: vars.updates.query,
        filters: vars.updates.filters,
      });
    },
    onSuccess: (updated) => {
      upsertCachedSearch(updated);
      toast.success(t('search.widgets.savedSearches.updateSuccess'));
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('search.widgets.savedSearches.updateFailed')));
    },
  });

  const deleteSearchMutation = useMutation({
    mutationKey: ['deleteSearch'],
    mutationFn: async (vars: { searchId: string; searchName?: string }): Promise<void> => {
      await api.delete(`/api/profiles/me/saved-searches/${vars.searchId}`);
    },
    onSuccess: (_result, vars) => {
      removeCachedSearch(vars.searchId);
      toast.success(
        vars.searchName
          ? t('search.widgets.savedSearches.deleteSuccessNamed', { name: vars.searchName })
          : t('search.widgets.savedSearches.deleteSuccess'),
      );
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('search.widgets.savedSearches.deleteFailed')));
    },
  });

  const toggleNotificationsMutation = useMutation({
    mutationKey: ['toggleSearchNotifications'],
    mutationFn: async (vars: { searchId: string; enabled: boolean }): Promise<SavedSearch> => {
      // The backend's `toggleSearchNotifications` reads `req.body.notificationsEnabled`,
      // so the body key must match exactly (sending `{ enabled }` always persisted false).
      const response = await api.put<SavedSearchPayload>(
        `/api/profiles/me/saved-searches/${vars.searchId}/notifications`,
        { notificationsEnabled: vars.enabled },
      );
      const payload = response.data;
      const raw = Array.isArray(payload) ? (payload[0] ?? {}) : extractSearch(payload);
      return normalizeSearch(raw, { id: vars.searchId });
    },
    onSuccess: (updated, vars) => {
      upsertCachedSearch(updated);
      toast.success(
        vars.enabled
          ? t('search.widgets.savedSearches.notificationsEnabled')
          : t('search.widgets.savedSearches.notificationsDisabled'),
      );
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('search.widgets.savedSearches.notificationsFailed')));
    },
  });

  const saveSearch = useCallback(
    async (
      name: string,
      query: string,
      filters?: SavedSearchFilters,
      notificationsEnabled: boolean = false,
    ): Promise<boolean> => {
      if (!name.trim() || !query.trim()) {
        toast.error(t('search.widgets.savedSearches.nameAndQueryRequired'));
        return false;
      }

      const normalizedName = name.trim();
      const normalizedQuery = query.trim();

      // Prevent obvious duplicates client-side before hitting the network.
      const duplicateExact = searches.some(
        (s) =>
          s.name.toLowerCase() === normalizedName.toLowerCase() &&
          s.query.toLowerCase() === normalizedQuery.toLowerCase(),
      );
      if (duplicateExact) {
        toast.error(t('search.duplicateExact'));
        return false;
      }
      const duplicateByName = searches.some(
        (s) => s.name.toLowerCase() === normalizedName.toLowerCase(),
      );
      if (duplicateByName) {
        toast.error(t('search.duplicateName') + '. ' + t('search.tryDifferentName'));
        return false;
      }

      try {
        await saveSearchMutation.mutateAsync({
          name: normalizedName,
          query: normalizedQuery,
          filters,
          notificationsEnabled,
        });
        return true;
      } catch {
        // onError surfaces the toast; the boolean tells the caller it failed.
        return false;
      }
    },
    [searches, t, saveSearchMutation],
  );

  const deleteSavedSearch = useCallback(
    async (searchId: string, searchName?: string): Promise<boolean> => {
      try {
        await deleteSearchMutation.mutateAsync({ searchId, searchName });
        return true;
      } catch {
        return false;
      }
    },
    [deleteSearchMutation],
  );

  const updateSearch = useCallback(
    async (
      searchId: string,
      updates: {
        name?: string;
        query?: string;
        filters?: SavedSearchFilters;
        notificationsEnabled?: boolean;
      },
    ): Promise<boolean> => {
      try {
        await updateSearchMutation.mutateAsync({ searchId, updates });
        return true;
      } catch {
        return false;
      }
    },
    [updateSearchMutation],
  );

  const toggleNotifications = useCallback(
    async (searchId: string, enabled: boolean): Promise<boolean> => {
      if (!searchId) {
        toast.error(t('search.widgets.savedSearches.invalidSearch'));
        return false;
      }
      try {
        await toggleNotificationsMutation.mutateAsync({ searchId, enabled });
        return true;
      } catch {
        return false;
      }
    },
    [toggleNotificationsMutation, t],
  );

  const searchExists = useCallback(
    (name: string, query?: string): boolean =>
      searches.some(
        (search) =>
          search.name.toLowerCase() === name.toLowerCase() ||
          (query !== undefined && search.query.toLowerCase() === query.toLowerCase()),
      ),
    [searches],
  );

  const getSearchById = useCallback(
    (searchId: string): SavedSearch | undefined => searches.find((search) => search.id === searchId),
    [searches],
  );

  const error = listQuery.error
    ? getErrorMessage(listQuery.error, t('search.widgets.savedSearches.loadFailed'))
    : null;

  return {
    searches,
    isLoading: listQuery.isLoading,
    isSaving: saveSearchMutation.isPending,
    error,
    saveSearch,
    deleteSavedSearch,
    updateSearch,
    toggleNotifications,
    searchExists,
    getSearchById,
    hasSearches: searches.length > 0,
    isAuthenticated,
  };
};
