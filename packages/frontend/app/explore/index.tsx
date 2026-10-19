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
 * URL holds the committed query and this screen renders the query DERIVED from
 * it — nothing is copied from the URL into a store. `commitQuery` is the only
 * path that writes the URL (and the store, for the surfaces off this route that
 * read the last search), and it runs on native too, where expo-router carries route params just as it does on
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
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { AppShellPanel } from '@oxy.so/bloom/app-shell';
import { useOxy } from '@oxy.so/services/ui/client';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type {
  LocationResolution,
  LocationSelection,
  LocationTokenFailure,
  Property,
} from '@homiio/shared-types';

import { SearchResultsView } from '@/components/search/SearchResultsView';
import { HomeSearch } from '@/components/search/HomeSearch';
import { ErrorState } from '@/components/ui/ErrorState';
import type { SearchQuery, SearchStep } from '@/components/search/types';
import { spacing } from '@/constants/styles';
import { useUserCoordinates } from '@/hooks/useHomeFeed';
import { useSearchQueryStore, type SearchFilterPatch } from '@/store/searchQueryStore';
import {
  buildSearchParamsForUrl,
  exploreHref,
  isNavigationChange,
  parseSearchParams,
  type ParsedLocation,
} from '@/utils/searchUrl';
import { resolveLegacyCityParam, resolveLocationRef } from '@/utils/resolveLocationRef';

export default function SearchScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const { isAuthenticated } = useOxy();
  const { data: deviceFix } = useUserCoordinates();

  /** The last committed query — shown only while a requested location resolves. */
  const committedQuery = useSearchQueryStore((s) => s.query);
  const [openStep, setOpenStep] = useState<SearchStep | null>(null);
  /**
   * A committed location the URL grammar cannot express, if one was attempted.
   *
   * Held so the refusal is visible. The alternative — navigating with `loc`
   * absent — produces a URL that looks fine and reopens as a global search.
   */
  const [unshareableLocation, setUnshareableLocation] = useState<LocationTokenFailure | null>(null);

  // Parsing is pure, so it is derived rather than an effect.
  //
  // `useLocalSearchParams()` returns a NEW OBJECT on every render, so the parse
  // is keyed on the params' serialised VALUE: `parsed.query` (and the `query`
  // derived from it below) keeps its identity until the URL actually changes.
  const paramsKey = JSON.stringify(params);
  const parsed = useMemo(
    () => parseSearchParams(JSON.parse(paramsKey) as typeof params),
    [paramsKey],
  );
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
  const needsResolving = locationRequest.kind === 'ref' || locationRequest.kind === 'legacy_city';

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
  }, [
    locationRequest,
    resolutionQuery.isPending,
    resolutionQuery.isFetching,
    resolutionQuery.isError,
    resolutionQuery.data,
  ]);

  const resolvedSelection = resolution.status === 'resolved' ? resolution.selection : null;

  /**
   * The query this screen shows — derived from the URL, never copied out of it.
   *
   * Only a `resolved` location is ever in force. While a requested location is
   * `resolving` (or has `failed`) the last committed query stays on screen
   * rather than a cleared one, because clearing it is how a failure becomes a
   * global feed.
   */
  const urlQueryInForce = locationRequest.kind === 'none' || resolvedSelection !== null;
  const query: SearchQuery = useMemo(
    () => (urlQueryInForce ? { ...parsed.query, location: resolvedSelection } : committedQuery),
    [urlQueryInForce, parsed.query, resolvedSelection, committedQuery],
  );

  /**
   * A legacy URL (`?city=`, `?query=`) rewritten to its canonical form once its
   * single match is known. The address bar is corrected under the user with a
   * `replace` — they did not navigate. Several matches never reach here: they
   * resolve to a failure and open the picker instead of auto-picking one.
   */
  const normalisedHref =
    parsed.needsNormalising && resolvedSelection
      ? exploreHref({ ...parsed.query, location: resolvedSelection })
      : null;

  /**
   * The ONE writer. Serialises the query to `loc`/`q`/filters and navigates;
   * this screen re-derives from the resulting params. The store is written in
   * the same step so the surfaces off this route that read the last search
   * (Home's composer seed) agree with the URL, and so a newly pushed location
   * shows this query, not an older one, while it resolves.
   *
   * A location change is a `push` — somewhere the user navigated to and can
   * leave with Back. A filter or sort tweak is a `replace`, because burying the
   * previous search under twenty history entries makes Back mean nothing.
   */
  const commitQuery = useCallback(
    (next: SearchQuery) => {
      const { params: urlParams, droppedLocation } = buildSearchParamsForUrl(next);

      // A location the URL cannot carry must not be committed THROUGH the URL.
      // Navigating anyway would write an address that reproduces a DIFFERENT
      // search — the location silently absent, which `parseSearchParams` reads
      // as "none requested" and answers globally. Refusing keeps the previous
      // URL and says so, which is the honest failure for a shape §2.1 reserves.
      if (droppedLocation) {
        setUnshareableLocation(droppedLocation);
        return;
      }
      setUnshareableLocation(null);

      const navigate = isNavigationChange(query, next);
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

  const handleEditSearch = useCallback(() => setOpenStep('where'), []);

  const handleSubmitSearch = useCallback(
    (next: SearchQuery) => {
      setOpenStep(null);
      commitQuery(next);
    },
    [commitQuery],
  );

  const handlePropertyPress = useCallback(
    (property: Property) => router.push(`/properties/${property.id}`),
    [router],
  );

  const handleRequireAuth = useCallback(() => router.push('/profile'), [router]);

  // The composer heads every state below: each of them offers "choose a place",
  // and it stays on screen so the area being asked about is always stated. The
  // results surface draws its own inside its top bar.
  // Every state below is one where the requested place is NOT in force, so the
  // composer must not describe the empty location as "Everywhere".
  const searchPanel = (
    <View style={styles.composer}>
      <HomeSearch
        query={query}
        openStep={openStep}
        onOpenStepChange={setOpenStep}
        onSubmit={handleSubmitSearch}
        locationUnresolved
      />
    </View>
  );

  // A location the URL cannot carry: the commit was refused, so say so rather
  // than leave the user looking at the previous search wondering why nothing
  // happened.
  if (unshareableLocation) {
    return (
      // An error is ONE panel; the results are two (`SearchResultsView`).
      <AppShellPanel>
        <View style={styles.root}>
          {searchPanel}
          <ErrorState
            title={
              t('search.location.unshareable.title', 'This area cannot be opened by link') ??
              undefined
            }
            description={
              t(
                'search.location.unshareable.description',
                'Try choosing a place or drawing a smaller area.',
              ) ?? undefined
            }
            retryLabel={t('search.location.chooseAnother', 'Choose a place') ?? undefined}
            onRetry={() => {
              setUnshareableLocation(null);
              setOpenStep('where');
            }}
          />
        </View>
      </AppShellPanel>
    );
  }

  // A failed resolution shows the reason and issues NO request. This is the
  // branch that used to be a silent fall-through to the global feed.
  if (resolution.status === 'failed') {
    return (
      // An error is ONE panel; the results are two (`SearchResultsView`).
      <AppShellPanel>
        <View style={styles.root}>
          {searchPanel}
          <ErrorState
            title={t('search.location.failed.title', 'We could not find that place') ?? undefined}
            description={
              t(`search.location.failed.${resolution.reason}`, {
                defaultValue:
                  t('search.location.failed.generic', 'Try choosing a different place.') ?? '',
              }) ?? undefined
            }
            retryLabel={t('search.location.chooseAnother', 'Choose a place') ?? undefined}
            onRetry={handleEditSearch}
          />
        </View>
      </AppShellPanel>
    );
  }

  return (
    <View style={styles.root}>
      {normalisedHref ? <Redirect href={normalisedHref} /> : null}
      <SearchResultsView
        query={query}
        onQueryChange={patchFilters}
        onCommitLocation={commitLocation}
        openStep={openStep}
        onOpenStepChange={setOpenStep}
        onSubmitSearch={handleSubmitSearch}
        onPropertyPress={handlePropertyPress}
        canSaveSearch={isAuthenticated}
        onRequireAuth={handleRequireAuth}
      />
    </View>
  );
}

/**
 * A stable string for "which location did the URL ask for".
 *
 * The resolution query keys on this rather than on the parsed object, so it
 * re-resolves when the location changes and not when an unrelated filter does.
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
  composer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    width: '100%',
    maxWidth: 850,
    alignSelf: 'center',
    zIndex: 1,
  },
});
