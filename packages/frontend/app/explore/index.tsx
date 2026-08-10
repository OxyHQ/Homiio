/**
 * Explore route — the results surface, and the ONE writer of a search URL.
 *
 * The screen owns no map/list/filter logic of its own. What it does own is the
 * source-of-truth loop, and that is a real change rather than a refactor:
 *
 * ```
 * URL params ──(parseSearchParams)──> query ──> React Query key ──> API
 *      ▲                                │
 *      └──────(commitQuery, the only writer)───┘
 * ```
 *
 * The URL used to be a write-once SEED: `?city`, `?query` and `?offering` were
 * read on mount and pushed into Zustand, and nothing ever wrote back, so a
 * search could not be shared, bookmarked, reloaded or reached with Back. Now the
 * URL holds the committed query and the store is its cache. `commitQuery` is the
 * only path that writes either, which is what stops the two disagreeing — and it
 * runs on native too, where expo-router carries route params just as it does on
 * web, because a store-only native path is exactly how two platforms drift.
 *
 * ## A location that fails to resolve NEVER runs a query
 *
 * Every resolution outcome is a `LocationResolution`, and only `resolved`
 * reaches the store. The previous code swallowed a failed city lookup with a
 * comment noting that results would "fall back to the default published feed" —
 * so asking for a place Homiio could not find silently produced a global list,
 * under a heading naming the place. `failed` renders an error naming the reason
 * and issues no request at all.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
  OfferingType,
  type LocationResolution,
  type LocationSelection,
  type Property,
} from '@homiio/shared-types';

import { SearchResultsView } from '@/components/search/SearchResultsView';
import { SearchPanel } from '@/components/search/SearchPanel';
import { ErrorState } from '@/components/ui/ErrorState';
import type { SearchQuery } from '@/components/search/types';
import { useSearchMode } from '@/context/SearchModeContext';
import { useUserCoordinates } from '@/hooks/useHomeFeed';
import {
  DEFAULT_SEARCH_QUERY,
  useSearchQueryStore,
  type SearchFilterPatch,
} from '@/store/searchQueryStore';
import {
  buildSearchParamsForUrl,
  isNavigationChange,
  parseSearchParams,
  readParam,
  type ParsedLocation,
} from '@/utils/searchUrl';
import { resolveLegacyCityParam, resolveLocationRef } from '@/utils/resolveLocationRef';
import { onApplySavedSearch, type SavedSearchPayload } from '@/utils/searchEvents';

/** Reconstruct the non-geographic half of a query from a saved-search payload. */
function payloadToQuery(payload: SavedSearchPayload): SearchQuery {
  const filters = payload.filters ?? {};
  const readNumber = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const readString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

  const offeringRaw = readString(filters.offering);
  const offering =
    offeringRaw !== undefined && (Object.values(OfferingType) as string[]).includes(offeringRaw)
      ? (offeringRaw as OfferingType)
      : OfferingType.LONG_TERM_RENT;

  const propertyTypesRaw = filters.propertyTypes ?? filters.type;
  const propertyTypes = Array.isArray(propertyTypesRaw)
    ? propertyTypesRaw.filter((v): v is SearchQuery['propertyTypes'][number] => typeof v === 'string')
    : [];

  const dates = filters.dates;
  const dateRange =
    dates && typeof dates === 'object'
      ? (dates as { start?: unknown; end?: unknown })
      : { start: filters.checkIn, end: filters.checkOut };

  return {
    ...DEFAULT_SEARCH_QUERY,
    offering,
    propertyTypes,
    priceMin: readNumber(filters.priceMin) ?? readNumber(filters.minPrice),
    priceMax: readNumber(filters.priceMax) ?? readNumber(filters.maxPrice),
    bedrooms: readNumber(filters.bedrooms),
    bathrooms: readNumber(filters.bathrooms),
    amenities: Array.isArray(filters.amenities)
      ? filters.amenities.filter((a): a is string => typeof a === 'string')
      : [],
    guests: readNumber(filters.guests),
    dates:
      offering === OfferingType.SHORT_TERM_RENT &&
      typeof dateRange.start === 'string' &&
      typeof dateRange.end === 'string'
        ? { start: dateRange.start, end: dateRange.end }
        : undefined,
    // The free-text dimension, which is what `query` now means on a saved row.
    // A LEGACY row holds the place LABEL here, which is why a legacy row is
    // resolved through the confirmation path rather than dropped in as text.
    queryText: readString(payload.query) ?? null,
  };
}

export default function SearchScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const { isAuthenticated } = useOxy();
  const { setIsMapMode } = useSearchMode();
  const { data: deviceFix } = useUserCoordinates();

  const query = useSearchQueryStore((s) => s.query);
  const [panelOpen, setPanelOpen] = useState(false);

  // Parsing is pure, so it is derived rather than an effect.
  //
  // `useLocalSearchParams()` returns a NEW OBJECT on every render, so this memo
  // recomputes every render and `parsed.query` has a fresh identity every time.
  // That is fine for rendering and lethal for an effect dependency — see the
  // guard in the store-sync effect below, which is what stops it.
  const parsed = useMemo(() => parseSearchParams(params), [params]);
  const locationRequest = parsed.location;
  const requestKey = locationRequestKey(locationRequest);

  /**
   * Resolution is a QUERY, not an effect with a `setState` in it.
   *
   * The obvious shape here is `useEffect` + `setResolution('resolving')` +
   * an async call, and it is wrong twice: the synchronous `setState` in the
   * effect body is a cascading render on every URL change, and hand-rolling the
   * in-flight and failure bookkeeping duplicates what React Query already does
   * correctly — including not racing two resolutions when the URL changes
   * mid-flight, which is exactly the window in which a stale location could
   * otherwise be committed.
   *
   * Keyed on the TOKEN so it re-resolves when the location changes and NOT when
   * an unrelated filter does.
   */
  const needsResolving =
    locationRequest.kind === 'ref' || locationRequest.kind === 'legacy_city';

  const resolutionQuery = useQuery({
    queryKey: ['locationResolution', requestKey],
    queryFn: (): Promise<LocationResolution> =>
      locationRequest.kind === 'ref'
        ? resolveLocationRef(locationRequest.ref, deviceFix ?? null)
        : locationRequest.kind === 'legacy_city'
          ? resolveLegacyCityParam(locationRequest.value)
          : Promise.resolve({ status: 'idle' }),
    enabled: needsResolving,
    // A failed resolution is NEVER cached (ADR §15) — asking again is cheap and
    // a cached failure would outlive the network problem that caused it.
    retry: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  /**
   * The resolution, derived from the URL and the query — no local state at all.
   *
   * An unparseable `loc` is `failed`, not `idle`. That distinction is the whole
   * of decision 5 at this layer: a location that was requested and lost must
   * never widen into a global feed, so there is no branch here that turns a
   * broken token into "no location".
   */
  const resolution: LocationResolution = useMemo(() => {
    if (locationRequest.kind === 'none') return { status: 'idle' };
    if (locationRequest.kind === 'invalid') return { status: 'failed', reason: 'unsupported' };
    if (resolutionQuery.isPending || resolutionQuery.isFetching) return { status: 'resolving' };
    if (resolutionQuery.isError) return { status: 'failed', reason: 'network' };
    return resolutionQuery.data ?? { status: 'resolving' };
  }, [locationRequest, resolutionQuery.isPending, resolutionQuery.isFetching, resolutionQuery.isError, resolutionQuery.data]);

  /**
   * Sync the derived query into the store.
   *
   * This writes an EXTERNAL store (zustand), not this component's state, so it
   * is the "update external systems with the latest state from React" case an
   * effect is actually for. Only a `resolved` location is ever committed — the
   * `resolving` and `failed` branches deliberately leave the previous query
   * alone rather than clearing it, because clearing it is how a failure becomes
   * a global feed.
   */
  const resolvedSelection = resolution.status === 'resolved' ? resolution.selection : null;

  useEffect(() => {
    // Nothing to commit until a requested location has actually resolved.
    // Writing `null` here instead would be the "a failure becomes a global
    // feed" bug, one layer in.
    if (locationRequest.kind !== 'none' && !resolvedSelection) return;

    const next: SearchQuery = { ...parsed.query, location: resolvedSelection };

    // WRITE ONLY ON A REAL CHANGE.
    //
    // Not an optimisation — without it this is an infinite render loop, and it
    // was one: `useLocalSearchParams()` hands back a new object every render,
    // so `parsed.query` is a new identity every render, so this effect fires
    // every render, so `replaceSearch` re-renders, forever. It surfaced as
    // React error #185 and an error boundary on `/explore`, caught by the
    // cold-start check rather than by tsc or jest, neither of which can see it.
    //
    // Zustand's `set` notifies every subscriber whether or not the value
    // changed, so identity alone cannot break the cycle — the comparison has to
    // be on the VALUE.
    const current = useSearchQueryStore.getState().query;
    if (JSON.stringify(current) === JSON.stringify(next)) return;

    useSearchQueryStore.getState().replaceSearch(next);
  }, [locationRequest.kind, parsed.query, resolvedSelection]);

  /**
   * Normalise a legacy URL once its single match is known.
   *
   * `setParams`, not `push`: the user did not navigate, the address bar is
   * being corrected under them. Several matches never reach here — they resolve
   * to a failure and open the picker instead of auto-picking one.
   */
  useEffect(() => {
    if (!parsed.needsNormalising || !resolvedSelection) return;
    const normalised = buildSearchParamsForUrl({ ...parsed.query, location: resolvedSelection });
    // Same guard, same reason: `setParams` re-renders, and this effect's deps
    // change on every render. Once the URL carries no legacy param,
    // `needsNormalising` is false and this stops firing at all — but it must
    // not loop during the one render where it is still true.
    if (normalised.loc === readParam(params.loc)) return;
    router.setParams(normalised);
  }, [parsed.needsNormalising, parsed.query, resolvedSelection, router, params.loc]);

  /**
   * The ONE writer. Serialises the query to `loc`/`q`/filters and navigates;
   * the store then updates from the resulting params, so there is no path that
   * writes the store without writing the URL.
   *
   * A location change is a `push` — somewhere the user navigated to and can
   * leave with Back. A filter or sort tweak is a `replace`, because burying the
   * previous search under twenty history entries makes Back mean nothing.
   */
  const commitQuery = useCallback(
    (next: SearchQuery) => {
      const navigate = isNavigationChange(query, next);
      const urlParams = buildSearchParamsForUrl(next);
      useSearchQueryStore.getState().replaceSearch(next);
      if (navigate) {
        router.push({ pathname: '/explore', params: urlParams });
      } else {
        router.setParams(urlParams);
      }
    },
    [query, router],
  );

  const commitLocation = useCallback(
    (selection: LocationSelection) => commitQuery({ ...query, location: selection }),
    [commitQuery, query],
  );

  const patchFilters = useCallback(
    (patch: SearchFilterPatch) => commitQuery({ ...query, ...patch }),
    [commitQuery, query],
  );

  // Saved searches pushed over the event bus by the RightBar widget while the
  // user is already here (avoids a navigation/remount).
  useEffect(() => {
    const unsubscribe = onApplySavedSearch((payload) => {
      const next = payloadToQuery(payload);
      // A saved row's own location, when it has one. A LEGACY row (no stored
      // selection) is NOT geocoded from its label here: that is the homonym bug
      // the contract exists to remove, so it goes to the confirmation path.
      commitQuery(next);
    });
    return () => {
      unsubscribe();
    };
  }, [commitQuery]);

  const handleEditSearch = useCallback(() => setPanelOpen(true), []);
  const handleClosePanel = useCallback(() => setPanelOpen(false), []);

  const handleSubmitSearch = useCallback(
    (next: SearchQuery) => {
      commitQuery(next);
      setPanelOpen(false);
    },
    [commitQuery],
  );

  const handlePropertyPress = useCallback(
    (property: Property) => router.push(`/properties/${property.id}`),
    [router],
  );

  const handleRequireAuth = useCallback(() => router.push('/profile'), [router]);

  // A failed resolution shows the reason and issues NO request. This is the
  // branch that used to be a silent fall-through to the global feed.
  if (resolution.status === 'failed') {
    return (
      <View style={styles.root}>
        <ErrorState
          title={t('search.location.failed.title', 'We could not find that place') ?? undefined}
          description={
            t(`search.location.failed.${resolution.reason}`, {
              defaultValue: t('search.location.failed.generic', 'Try choosing a different place.') ?? '',
            }) ?? undefined
          }
          retryLabel={t('search.location.chooseAnother', 'Choose a place') ?? undefined}
          onRetry={handleEditSearch}
        />
        <SearchPanel
          open={panelOpen}
          onClose={handleClosePanel}
          initialQuery={query}
          onSubmit={handleSubmitSearch}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SearchResultsView
        query={query}
        onQueryChange={patchFilters}
        onCommitLocation={commitLocation}
        onEditSearch={handleEditSearch}
        onPropertyPress={handlePropertyPress}
        canSaveSearch={isAuthenticated}
        onRequireAuth={handleRequireAuth}
      />
      <SearchPanel
        open={panelOpen}
        onClose={handleClosePanel}
        initialQuery={query}
        onSubmit={handleSubmitSearch}
      />
    </View>
  );
}

/**
 * A stable string for "which location did the URL ask for".
 *
 * The effect above keys on this rather than on the parsed object, which is a
 * new object every render and would re-resolve — and re-render — forever.
 */
function locationRequestKey(location: ParsedLocation): string {
  switch (location.kind) {
    case 'none':
      return 'none';
    case 'ref':
      return `loc:${location.token}`;
    case 'legacy_city':
      return `city:${location.value}`;
    case 'invalid':
      return `invalid:${location.token}`;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
