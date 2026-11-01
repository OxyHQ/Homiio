import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { SavedSearch, SavedSearchFilters } from '@/store/savedSearchesStore';
import { toast } from '@oxy.so/bloom/toast';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useOxy } from '@oxy.so/services/ui/client';
import { api, ApiError, isBoundOxyInstance, isBoundSubjectUnavailable } from '@/utils/api';
import {
  accountOwnerKey,
  assertAccountOwner,
  isExactAccountProjection,
  useAccountOwnerGuard,
  withAccountOwner,
  type AccountOwner,
} from '@/hooks/useAccountOwner';
import { AVAILABLE_HOUSING_ALERT_RULE_TYPES } from '@homiio/shared-types/watch';
import type {
  AlertChannel,
  HousingAlertRule,
  HousingAlertRuleType,
  LocationSelection,
  PushPrivacyMode,
  WatchAlertStatus,
  WatchCadence,
} from '@homiio/shared-types';

/**
 * Stable React Query key for the authenticated user's saved searches. Mutations
 * write the freshly-returned server object back to this cache, so the list and
 * every widget reading it stay in sync without a refetch flash.
 */
export const SAVED_SEARCHES_KEY = ['savedSearches'] as const;

/** Stable empty-list reference for the logged-out / not-yet-loaded state. */
const EMPTY_SEARCHES: SavedSearch[] = [];

/**
 * A saved search as it can arrive from the backend. The API has historically
 * used a few different field names (e.g. `title` vs `name`,
 * `notificationsEnabled` vs `notifications`), so every field is optional here
 * and normalised into a canonical {@link SavedSearch} before use.
 */
interface RawSavedSearch {
  id?: string;
  name?: string;
  title?: string;
  query?: string;
  search?: string;
  location?: LocationSelection | null;
  locationStatus?: 'resolved' | 'needs_confirmation';
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

  // The watch half (#356). Every field optional: an older backend answers
  // without them, and the normaliser below turns that into a silent saved
  // search rather than into `undefined` reaching a switch.
  locToken?: string;
  queryVersion?: number;
  isPrimaryArea?: boolean;
  cadence?: WatchCadence;
  channels?: AlertChannel[];
  alertRules?: HousingAlertRule[];
  availableRuleTypes?: HousingAlertRuleType[];
  mutedUntil?: string | null;
  pushPrivacyMode?: PushPrivacyMode;
  hasArea?: boolean;
  alertStatus?: WatchAlertStatus;
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

const normalizeSearch = (
  raw: RawSavedSearch,
  defaults: Partial<SavedSearch> = {},
): SavedSearch => ({
  id: raw.id ?? defaults.id ?? '',
  name: raw.name ?? raw.title ?? defaults.name ?? '',
  query: raw.query ?? raw.search ?? defaults.query ?? '',
  location: raw.location ?? defaults.location ?? null,
  // Defaults to `needs_confirmation` when the field is ABSENT, not to
  // `resolved`. An older backend, a cached payload or a shape this normaliser
  // does not recognise must land on the cautious side: the cost of a spurious
  // "confirm where" prompt is one tap, and the cost of the opposite default is
  // a saved alert quietly running against the whole planet.
  locationStatus: raw.locationStatus ?? (raw.location ? 'resolved' : 'needs_confirmation'),
  filters: raw.filters ?? raw.criteria ?? defaults.filters,
  notifications:
    typeof raw.notifications === 'boolean'
      ? raw.notifications
      : Boolean(
          raw.notificationsEnabled ?? raw.emailNotifications ?? raw.pushNotifications ?? false,
        ),
  notificationsEnabled:
    typeof raw.notificationsEnabled === 'boolean'
      ? raw.notificationsEnabled
      : typeof raw.notifications === 'boolean'
        ? raw.notifications
        : false,
  createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
  updatedAt: raw.updatedAt ?? raw.updated_at ?? new Date().toISOString(),

  // The watch half. `cadence` defaults to `'off'` for the same reason the
  // column does: a payload that does not mention alerting describes a saved
  // search that does not alert, and the cautious reading is the only safe
  // default for something that sends notifications.
  locToken: raw.locToken,
  queryVersion: raw.queryVersion,
  isPrimaryArea: raw.isPrimaryArea ?? false,
  cadence: raw.cadence ?? 'off',
  channels: raw.channels ?? ['in_app'],
  alertRules: raw.alertRules ?? [],
  // Defaults to the CONTRACT's list rather than to an empty one: an empty list
  // would render every switch as unavailable and read as a broken feature,
  // where the contract's list is at worst optimistic and is corrected by the
  // server's own 400 if a rule is refused.
  availableRuleTypes: raw.availableRuleTypes ?? [...AVAILABLE_HOUSING_ALERT_RULE_TYPES],
  mutedUntil: raw.mutedUntil ?? null,
  pushPrivacyMode: raw.pushPrivacyMode ?? 'discreet',
  hasArea: raw.hasArea,
  alertStatus: raw.alertStatus,
});

/** What the alert-settings screen may change about a watch. */
interface WatchAlertSettingsInput {
  cadence?: WatchCadence;
  channels?: AlertChannel[];
  alertRules?: HousingAlertRule[];
  /** ISO timestamp, or `null` to clear a mute. */
  mutedUntil?: string | null;
  pushPrivacyMode?: PushPrivacyMode;
  isPrimaryArea?: boolean;
}

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
    location?: LocationSelection | null,
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
  /**
   * Change what a watch listens for, how often it may speak, and through which
   * channels (#356).
   *
   * ONE mutation for all of them rather than one per field, because they are
   * decided together on one screen and because the server writes `cadence` and
   * the legacy `notificationsEnabled` in a single statement — splitting the
   * client call would put a window between two halves of one fact.
   */
  updateAlertSettings: (searchId: string, settings: WatchAlertSettingsInput) => Promise<boolean>;
  /** Make this the area Home opens on. The server clears whichever held it. */
  setPrimaryArea: (searchId: string) => Promise<boolean>;
  searchExists: (name: string, query?: string) => boolean;
  getSearchById: (id: string) => SavedSearch | undefined;
  hasSearches: boolean;
  isAuthenticated: boolean;
}

/**
 * The ONE definition of the saved-searches list query.
 *
 * Shared rather than repeated because two hooks read it — this one and
 * {@link usePrimarySavedArea}, which the location ladder calls — and React Query
 * de-duplicates on the KEY plus the fetcher's behaviour. Two copies of the
 * fetcher would still share a cache entry and would drift the day one of them
 * learned something the other did not, which is the worst version of this: one
 * consumer silently reading a shape the other stopped producing.
 */
export const savedSearchesKeyFor = (owner: AccountOwner | null) =>
  [...SAVED_SEARCHES_KEY, ...accountOwnerKey(owner)] as const;

/** Non-secret, process-local identity for comparing paused mutation owners. */
function mutationOwnerKey(owner: AccountOwner): string {
  const [, , epoch, instance, generation] = accountOwnerKey(owner);
  return JSON.stringify([epoch, instance, generation]);
}

const savedSearchOwners = new WeakMap<
  object,
  { owner: AccountOwner; data: SavedSearch[] | undefined; revision: number }
>();

class SupersededSavedSearchRead extends Error {}

const savedSearchReadRevisions = new WeakMap<
  SavedSearch[],
  { owner: AccountOwner; query: object; revision: number }
>();

function hasVerifiedSavedSearches(client: QueryClient, owner: AccountOwner | null): boolean {
  if (!owner) return false;
  const query = client.getQueryCache().find({ queryKey: savedSearchesKeyFor(owner), exact: true });
  const binding = query && savedSearchOwners.get(query);
  return Boolean(
    binding?.data &&
      query?.state.data === binding.data &&
      isBoundOxyInstance(binding.owner.oxyServices) &&
      isExactAccountProjection(binding.owner),
  );
}

function savedSearchesQueryOptions(owner: AccountOwner | null, client: QueryClient) {
  const queryKey = savedSearchesKeyFor(owner);
  const verified = hasVerifiedSavedSearches(client, owner);
  return {
    queryKey,
    enabled: Boolean(owner),
    staleTime: verified ? 1000 * 30 : 0,
    ...(verified ? {} : { refetchOnMount: 'always' as const }),
    gcTime: 1000 * 60 * 10,
    structuralSharing: (_oldData: unknown, newData: unknown) => {
      if (!Array.isArray(newData)) return newData;
      const query = client.getQueryCache().find({ queryKey, exact: true });
      const read = savedSearchReadRevisions.get(newData);
      if (!read) return newData;
      if (
        !query ||
        read.query !== query ||
        read.revision !== (savedSearchOwners.get(query)?.revision ?? 0) ||
        !isBoundOxyInstance(read.owner.oxyServices) ||
        !isExactAccountProjection(read.owner)
      ) {
        throw new SupersededSavedSearchRead('Saved search read was superseded');
      }
      savedSearchOwners.set(query, { owner: read.owner, data: newData, revision: read.revision });
      return newData;
    },
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      withAccountOwner(owner, async (current): Promise<SavedSearch[]> => {
        const query = client.getQueryCache().find({ queryKey, exact: true });
        const previous = query && savedSearchOwners.get(query);
        const revision = previous?.revision ?? 0;
        if (query && (!previous || !isExactAccountProjection(previous.owner))) {
          savedSearchOwners.set(query, { owner: current, data: undefined, revision });
        }
        const response = await api.get<SavedSearchPayload>('/api/profiles/me/saved-searches', {
          owner: current,
        });
        const searches = extractSearchList(response.data).map((raw) => normalizeSearch(raw));
        assertAccountOwner(current);
        if (signal.aborted) throw new Error('Saved search read was cancelled');
        if (query) savedSearchReadRevisions.set(searches, { owner: current, query, revision });
        return searches;
      }),
  };
}

function useBoundSavedSearchesQuery(owner: AccountOwner | null, client: QueryClient) {
  const query = useQuery(savedSearchesQueryOptions(owner, client));
  const verified = hasVerifiedSavedSearches(client, owner);
  useEffect(() => {
    if (owner && !verified && query.status === 'success' && query.fetchStatus === 'idle') {
      void query.refetch({ cancelRefetch: false });
    }
  }, [owner, verified, query.status, query.fetchStatus, query.refetch]);
  return { query, verified };
}

function ownerIsBound(owner: AccountOwner | null): boolean {
  try {
    assertAccountOwner(owner);
    return isBoundOxyInstance(owner.oxyServices);
  } catch {
    return false;
  }
}

/** Locate a currently bound result for the out-of-React location observer. */
export function savedSearchesReading(client: QueryClient, userId: string | undefined) {
  for (const query of client.getQueryCache().findAll({ queryKey: SAVED_SEARCHES_KEY })) {
    const binding = savedSearchOwners.get(query);
    if (
      !binding ||
      binding.owner.userId !== userId ||
      !isBoundOxyInstance(binding.owner.oxyServices) ||
      !isExactAccountProjection(binding.owner)
    )
      continue;
    const verified = Boolean(binding.data && query.state.data === binding.data);
    return {
      data: verified ? binding.data : undefined,
      isPending: verified
        ? query.state.status === 'pending'
        : query.state.status !== 'error' && query.state.fetchStatus !== 'paused',
      isFetching: query.state.fetchStatus === 'fetching',
      isUnavailable:
        !verified && (query.state.status === 'error' || query.state.fetchStatus === 'paused'),
    };
  }
  const paused = client
    .getQueryCache()
    .findAll({ queryKey: SAVED_SEARCHES_KEY })
    .some((query) => query.queryKey[1] === userId && query.state.fetchStatus === 'paused');
  return { data: undefined, isPending: !paused, isFetching: false, isUnavailable: paused };
}

/**
 * The primary area's selection, or `null`.
 *
 * PURE and exported so the rule is testable without rendering a hook, because
 * the rule is the part that can be wrong. Two ways it could be, and both are
 * pinned in `__tests__/home/primarySavedArea.test.ts`:
 *
 *  - **Picking the wrong watch.** The flag is the only thing that decides.
 *    Falling back to "the most recently updated one with a location" would scope
 *    somebody's whole Home to whichever city they bookmarked last and present it
 *    as their home area — the opaque personalisation #353 refused when it left
 *    this rung inert rather than approximating it.
 *  - **Returning an unusable selection.** A watch whose location never resolved
 *    carries a LABEL and not a place (ADR 0002 §11), so scoping by it would mean
 *    re-geocoding the label and taking the first hit, which is the homonym bug.
 *    Such a watch is skipped, and skipping is safe because the ladder treats an
 *    absent rung as a fall-through.
 *
 * The server already guarantees at most one flagged row per person (a partial
 * unique index), so this does not have to break a tie — and deliberately does
 * not invent a rule for one, because a client-side tiebreak would hide a server
 * invariant having broken.
 */
export function primaryAreaOf(searches: readonly SavedSearch[]): LocationSelection | null {
  const primary = searches.find((search) => search.isPrimaryArea);
  if (!primary) return null;
  if (primary.locationStatus !== 'resolved') return null;
  return primary.location ?? null;
}

/** What the location ladder's saved-area rung needs, and nothing more. */
export interface PrimarySavedArea {
  /**
   * The primary area's stored selection, or `null`.
   *
   * `null` is the COMMON case and is unambiguous: it means "this person has no
   * primary area", which the ladder treats as a skip to the next rung. It is
   * NOT "we do not know yet" — that is {@link PrimarySavedArea.pending}, and
   * conflating the two is what would let Home resolve to the device position and
   * then jump to a saved area a moment later.
   */
  readonly selection: LocationSelection | null;
  /**
   * Whether the answer is still unknown.
   *
   * `false` for a logged-out user, who cannot have one — so the ladder never
   * waits on a request that will not be made.
   */
  readonly pending: boolean;
  /** The account's saved area could not be established yet. */
  readonly unavailable?: boolean;
}

/**
 * The primary area of this person's saved searches, for the location ladder
 * (#353's second rung, wired here now that #356 gives it something to read).
 *
 * A watch marked `isPrimaryArea` is an EXPLICIT choice — at most one per person,
 * enforced by a partial unique index — which is why it may outrank the device
 * position. The rung deliberately has no fallback to "the most recently updated
 * saved search": that would scope somebody's whole Home to whichever city they
 * happened to bookmark last and present it as their home area, which is the
 * opaque personalisation #353 refused and #356 has no reason to reintroduce.
 *
 * A watch whose location never resolved (`locationStatus: 'needs_confirmation'`)
 * is skipped rather than used, because there is nothing to scope BY — the row
 * carries a label, not a place, and re-geocoding it is the homonym bug.
 */
export const usePrimarySavedArea = (): PrimarySavedArea => {
  const { isAuthenticated } = useOxy();
  const { owner } = useAccountOwnerGuard();
  const client = useQueryClient();
  const { query, verified } = useBoundSavedSearchesQuery(owner, client);
  const valid = Boolean(owner);
  const unavailable =
    isBoundSubjectUnavailable() || (!verified && (query.fetchStatus === 'paused' || query.isError));
  return useMemo(
    () =>
      primarySavedAreaOf(isAuthenticated, {
        isPending: valid
          ? !unavailable && ((!verified && !query.isError) || query.isPending)
          : !unavailable,
        data: valid && verified ? query.data : undefined,
        isUnavailable: unavailable,
      }),
    [isAuthenticated, valid, verified, unavailable, query.isPending, query.isError, query.data],
  );
};

/**
 * The saved-area rung from the session and the saved-searches query.
 *
 * Pure, and separate from {@link usePrimarySavedArea}, because the rung is read
 * in two places that must agree: the hook, and `observeInferredScope`, which
 * reads the same query out of the cache.
 */
export function primarySavedAreaOf(
  isAuthenticated: boolean,
  query: {
    readonly isPending: boolean;
    readonly data: readonly SavedSearch[] | undefined;
    readonly isUnavailable?: boolean;
  },
): PrimarySavedArea {
  if (!isAuthenticated) return { selection: null, pending: false };
  if (query.isUnavailable) return { selection: null, pending: false, unavailable: true };
  // `isPending` is true while disabled too, so the guard above has to come
  // first — otherwise a logged-out Home would wait forever for a request that
  // is never sent.
  if (query.isPending) return { selection: null, pending: true };
  return { selection: primaryAreaOf(query.data ?? []), pending: false };
}

type SavedSearchAction = { ownerKey: string };
type SaveSearchInput = {
  name: string;
  query: string;
  filters?: SavedSearchFilters;
  notificationsEnabled?: boolean;
  location?: LocationSelection | null;
};
type UpdateSearchInput = {
  searchId: string;
  updates: {
    name?: string;
    query?: string;
    filters?: SavedSearchFilters;
    notificationsEnabled?: boolean;
  };
};
type DeleteSearchInput = { searchId: string; searchName?: string };
type AlertSettingsInput = { searchId: string; settings: WatchAlertSettingsInput };

export const useSavedSearches = (): UseSavedSearches => {
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();
  const { owner, isCurrent } = useAccountOwnerGuard();
  const queryClient = useQueryClient();
  const bindings = useRef(new WeakMap<object, { owner: AccountOwner; input: unknown }>());
  function capture(input: object): SavedSearchAction {
    if (!owner || !isCurrent(owner)) throw new Error('The active account changed');
    const action = { ownerKey: mutationOwnerKey(owner) };
    bindings.current.set(action, { owner, input });
    return action;
  }
  function captured<T>(variables: SavedSearchAction): { owner: AccountOwner; input: T } {
    const binding = bindings.current.get(variables);
    if (!binding || !isCurrent(binding.owner)) throw new Error('The active account changed');
    return binding as { owner: AccountOwner; input: T };
  }
  function currentFor(variables: SavedSearchAction): AccountOwner | null {
    const current = bindings.current.get(variables)?.owner;
    return current && isCurrent(current) ? current : null;
  }

  /**
   * The single source of truth for the user's saved searches. Gated on
   * `isAuthenticated` so a logged-out client never fires the request (the route
   * sits behind `oxy.auth()` and `utils/api.ts` sends no `Authorization` header
   * when there is no token, which would otherwise 401-spam).
   */
  const { query: listQuery, verified } = useBoundSavedSearchesQuery(owner, queryClient);

  // When logged out the query is disabled and never resolves, so fall back to a
  // stable empty list rather than leaving `searches` undefined. Memoised on the
  // query data so consumers' `useCallback`/`useMemo` deps stay referentially
  // stable across renders where the data is unchanged.
  const searches = useMemo<SavedSearch[]>(
    () => (owner && verified ? (listQuery.data ?? EMPTY_SEARCHES) : EMPTY_SEARCHES),
    [owner, verified, listQuery.data],
  );

  /** Replace a single search in the cached list by id, or append if new. */
  const upsertCachedSearch = useCallback(
    async (next: SavedSearch, capturedOwner: AccountOwner) => {
      const queryKey = savedSearchesKeyFor(capturedOwner);
      await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false });
      if (!isCurrent(capturedOwner)) return;
      const query = queryClient.getQueryCache().find({ queryKey, exact: true });
      if (!query || !hasVerifiedSavedSearches(queryClient, capturedOwner)) {
        void queryClient.invalidateQueries({ queryKey, exact: true });
        return;
      }
      queryClient.setQueryData<SavedSearch[]>(queryKey, (prev) => {
        const list = prev ?? [];
        const index = list.findIndex((s) => s.id === next.id);
        const result = [...list];
        if (index === -1) result.push(next);
        else result[index] = next;
        if (query) {
          savedSearchOwners.set(query, {
            owner: capturedOwner,
            data: result,
            revision: (savedSearchOwners.get(query)?.revision ?? 0) + 1,
          });
        }
        return result;
      });
    },
    [queryClient, isCurrent],
  );

  /** Remove a single search from the cached list by id. */
  const removeCachedSearch = useCallback(
    async (searchId: string, capturedOwner: AccountOwner) => {
      const queryKey = savedSearchesKeyFor(capturedOwner);
      await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false });
      if (!isCurrent(capturedOwner)) return;
      const query = queryClient.getQueryCache().find({ queryKey, exact: true });
      if (!query || !hasVerifiedSavedSearches(queryClient, capturedOwner)) {
        void queryClient.invalidateQueries({ queryKey, exact: true });
        return;
      }
      queryClient.setQueryData<SavedSearch[]>(queryKey, (prev) => {
        const result = (prev ?? []).filter((s) => s.id !== searchId);
        if (query) {
          savedSearchOwners.set(query, {
            owner: capturedOwner,
            data: result,
            revision: (savedSearchOwners.get(query)?.revision ?? 0) + 1,
          });
        }
        return result;
      });
    },
    [queryClient, isCurrent],
  );

  const saveSearchMutation = useMutation({
    mutationKey: ['saveSearch'],
    mutationFn: async (vars: SavedSearchAction): Promise<SavedSearch> => {
      const { owner: current, input } = captured<SaveSearchInput>(vars);
      const response = await api.post<SavedSearchPayload>(
        '/api/profiles/me/saved-searches',
        {
          name: input.name,
          query: input.query,
          filters: input.filters,
          notificationsEnabled: Boolean(input.notificationsEnabled),
          ...(input.location ? { location: input.location } : {}),
        },
        { owner: current },
      );

      const payload = response.data;
      const raw = Array.isArray(payload) ? (payload[0] ?? {}) : extractSearch(payload);
      return normalizeSearch(raw, {
        name: input.name,
        query: input.query,
        filters: input.filters,
      });
    },
    onSuccess: async (saved, vars) => {
      const current = currentFor(vars);
      if (!current) return;
      await upsertCachedSearch(saved, current);
      if (!isCurrent(current)) return;
      toast.success(t('search.widgets.savedSearches.saveSuccess', { name: saved.name }));
    },
    onError: (error: unknown, vars) => {
      if (!currentFor(vars)) return;
      if (isApiError(error) && error.status === 409) {
        const response =
          error.response && typeof error.response === 'object'
            ? (error.response as { message?: unknown })
            : undefined;
        const responseMessage =
          typeof response?.message === 'string' ? response.message : t('search.duplicateName');
        toast.error(responseMessage + '. ' + t('search.tryDifferentName'));
        return;
      }
      toast.error(getErrorMessage(error, t('search.widgets.savedSearches.saveFailed')));
    },
  });

  const updateSearchMutation = useMutation({
    mutationKey: ['updateSearch'],
    mutationFn: async (vars: SavedSearchAction): Promise<SavedSearch> => {
      const { owner: current, input } = captured<UpdateSearchInput>(vars);
      const response = await api.put<SavedSearchPayload>(
        `/api/profiles/me/saved-searches/${input.searchId}`,
        input.updates,
        { owner: current },
      );
      const payload = response.data;
      const raw = Array.isArray(payload) ? (payload[0] ?? {}) : extractSearch(payload);
      return normalizeSearch(raw, {
        id: input.searchId,
        name: input.updates.name,
        query: input.updates.query,
        filters: input.updates.filters,
      });
    },
    onSuccess: async (updated, vars) => {
      const current = currentFor(vars);
      if (!current) return;
      await upsertCachedSearch(updated, current);
      if (!isCurrent(current)) return;
      toast.success(t('search.widgets.savedSearches.updateSuccess'));
    },
    onError: (error: unknown, vars) => {
      if (!currentFor(vars)) return;
      toast.error(getErrorMessage(error, t('search.widgets.savedSearches.updateFailed')));
    },
  });

  const deleteSearchMutation = useMutation({
    mutationKey: ['deleteSearch'],
    mutationFn: async (vars: SavedSearchAction): Promise<void> => {
      const { owner: current, input } = captured<DeleteSearchInput>(vars);
      await api.delete(`/api/profiles/me/saved-searches/${input.searchId}`, { owner: current });
    },
    onSuccess: async (_result, vars) => {
      const current = currentFor(vars);
      if (!current) return;
      const { input } = captured<DeleteSearchInput>(vars);
      await removeCachedSearch(input.searchId, current);
      if (!isCurrent(current)) return;
      toast.success(
        input.searchName
          ? t('search.widgets.savedSearches.deleteSuccessNamed', { name: input.searchName })
          : t('search.widgets.savedSearches.deleteSuccess'),
      );
    },
    onError: (error: unknown, vars) => {
      if (!currentFor(vars)) return;
      toast.error(getErrorMessage(error, t('search.widgets.savedSearches.deleteFailed')));
    },
  });

  const saveSearch = useCallback(
    async (
      name: string,
      query: string,
      filters?: SavedSearchFilters,
      notificationsEnabled: boolean = false,
      location: LocationSelection | null = null,
    ): Promise<boolean> => {
      if (!owner || !isCurrent(owner)) return false;
      // A name, and SOMETHING to search — a place, free text, or both. It used
      // to require a non-empty `query`, which held the location's LABEL; now
      // that `query` is the free-text dimension and is normally empty for a
      // place search, that check would have rejected every saved city.
      if (!name.trim() || (!location && !query.trim())) {
        toast.error(t('search.widgets.savedSearches.nameAndQueryRequired'));
        return false;
      }

      const normalizedName = name.trim();
      const normalizedQuery = query.trim();

      // Prevent obvious duplicates client-side before hitting the network.
      //
      // The NAME check below is what actually protects the
      // `(oxy_user_id, name)` unique index; this one only catches a re-save of
      // an identical row. Neither compares locations, because two saved
      // searches over two different cities are two different searches even when
      // their names collide — which is why the default name now carries the
      // administrative parent (`savedSearchName`) and a residual collision is a
      // prompt to rename rather than an overwrite.
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
        await saveSearchMutation.mutateAsync(
          capture({
            name: normalizedName,
            query: normalizedQuery,
            filters,
            notificationsEnabled,
            location,
          }),
        );
        return isCurrent(owner);
      } catch {
        // onError surfaces the toast; the boolean tells the caller it failed.
        return false;
      }
    },
    [searches, t, saveSearchMutation, owner, isCurrent, capture],
  );

  const deleteSavedSearch = useCallback(
    async (searchId: string, searchName?: string): Promise<boolean> => {
      try {
        await deleteSearchMutation.mutateAsync(capture({ searchId, searchName }));
        return isCurrent(owner);
      } catch {
        return false;
      }
    },
    [deleteSearchMutation, owner, isCurrent, capture],
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
        await updateSearchMutation.mutateAsync(capture({ searchId, updates }));
        return isCurrent(owner);
      } catch {
        return false;
      }
    },
    [updateSearchMutation, owner, isCurrent, capture],
  );

  const alertSettingsMutation = useMutation({
    mutationKey: ['updateWatchAlertSettings'],
    mutationFn: async (vars: SavedSearchAction): Promise<SavedSearch> => {
      const { owner: current, input } = captured<AlertSettingsInput>(vars);
      const response = await api.put<SavedSearchPayload>(
        `/api/profiles/me/saved-searches/${input.searchId}`,
        input.settings,
        { owner: current },
      );
      const payload = response.data;
      const raw = Array.isArray(payload) ? (payload[0] ?? {}) : extractSearch(payload);
      return normalizeSearch(raw, { id: input.searchId });
    },
    onSuccess: async (updated, vars) => {
      const current = currentFor(vars);
      if (current) await upsertCachedSearch(updated, current);
    },
    onError: (error: unknown, vars) => {
      if (!currentFor(vars)) return;
      // The server refuses a rule it cannot evaluate rather than storing a dead
      // switch, so this path is reachable by design and needs its own message —
      // "update failed" would leave the user re-trying something that will
      // never work.
      if (isApiError(error) && error.status === 400) {
        const response =
          error.response && typeof error.response === 'object'
            ? (error.response as { code?: unknown; message?: unknown })
            : undefined;
        if (response?.code === 'RULE_UNAVAILABLE') {
          toast.error(t('alerts.settings.ruleUnavailable'));
          return;
        }
      }
      toast.error(getErrorMessage(error, t('alerts.settings.updateFailed')));
    },
  });

  const updateAlertSettings = useCallback(
    async (searchId: string, settings: WatchAlertSettingsInput): Promise<boolean> => {
      try {
        await alertSettingsMutation.mutateAsync(capture({ searchId, settings }));
        if (!isCurrent(owner)) return false;
        toast.success(t('alerts.settings.updated'));
        return true;
      } catch {
        return false;
      }
    },
    [alertSettingsMutation, t, owner, isCurrent, capture],
  );

  const setPrimaryArea = useCallback(
    async (searchId: string): Promise<boolean> => {
      try {
        await alertSettingsMutation.mutateAsync(
          capture({ searchId, settings: { isPrimaryArea: true } }),
        );
        if (!isCurrent(owner)) return false;
        // The server clears whichever watch previously held the flag, in the
        // same transaction. The local cache cannot know WHICH one that was
        // without re-reading, so the whole list is invalidated rather than
        // patched — a patched cache would show two primary areas until the next
        // refetch, which is precisely the state the partial unique index makes
        // impossible on the server.
        await queryClient.invalidateQueries({ queryKey: savedSearchesKeyFor(owner), exact: true });
        if (!isCurrent(owner)) return false;
        toast.success(t('alerts.settings.primaryAreaSet'));
        return true;
      } catch {
        return false;
      }
    },
    [alertSettingsMutation, queryClient, t, owner, isCurrent, capture],
  );

  const searchExists = useCallback(
    (name: string, query?: string): boolean =>
      ownerIsBound(owner) &&
      searches.some(
        (search) =>
          search.name.toLowerCase() === name.toLowerCase() ||
          (query !== undefined && search.query.toLowerCase() === query.toLowerCase()),
      ),
    [searches, owner],
  );

  const getSearchById = useCallback(
    (searchId: string): SavedSearch | undefined =>
      ownerIsBound(owner) ? searches.find((search) => search.id === searchId) : undefined,
    [searches, owner],
  );

  const unavailable =
    isAuthenticated &&
    ((!owner && isBoundSubjectUnavailable()) || (!verified && listQuery.fetchStatus === 'paused'));
  const error = unavailable
    ? t('search.widgets.savedSearches.loadFailed')
    : listQuery.error instanceof SupersededSavedSearchRead
      ? verified
        ? null
        : t('search.widgets.savedSearches.loadFailed')
      : listQuery.error
        ? getErrorMessage(listQuery.error, t('search.widgets.savedSearches.loadFailed'))
        : null;

  return {
    searches,
    isLoading:
      !unavailable &&
      ((isAuthenticated && !owner) ||
        (Boolean(owner) && !verified && !listQuery.isError) ||
        listQuery.isLoading),
    isSaving: Boolean(
      saveSearchMutation.isPending &&
        saveSearchMutation.variables &&
        owner &&
        saveSearchMutation.variables.ownerKey === mutationOwnerKey(owner),
    ),
    error,
    saveSearch,
    deleteSavedSearch,
    updateSearch,
    updateAlertSettings,
    setPrimaryArea,
    searchExists,
    getSearchById,
    hasSearches: searches.length > 0,
    isAuthenticated,
  };
};
