/**
 * Home's sections, for the committed scope (#353).
 *
 * ## One query, keyed by the scope
 *
 * `['homeSections', locationKey(selection), offering]`. Every consequence worth
 * having falls out of that key rather than being enforced:
 *
 *  - **A late response cannot land under the wrong heading.** Switching from
 *    Madrid to Barcelona changes the key, so Madrid's in-flight response
 *    resolves into Madrid's cache entry and is never read again. Nothing has to
 *    cancel anything, and there is no request-id to compare.
 *  - **Pull-to-refresh keeps the scope exactly.** Refreshing REFETCHES this key.
 *    It does not re-run the location ladder, so a refresh cannot move the user
 *    somewhere else — see {@link useHomeSections}'s `refresh`.
 *  - **No coordinate reaches the key.** `locationKey`'s `current_location`
 *    branch emits `here:25000` and has no coordinate to emit (ADR 0002 §8.2).
 *
 * ## Live, cached, stale — three states, told apart honestly
 *
 * The acceptance criterion is "la UI diferencia datos live, cacheados y
 * desactualizados", and the three come from different facts:
 *
 *  - `live` — this session fetched it and the server's `generatedAt` is recent.
 *  - `cached` — it came off disk; no successful fetch has happened yet.
 *  - `stale` — we have data and the newest attempt FAILED, or the server's
 *    `generatedAt` is older than {@link STALE_AFTER_MS}.
 *
 * `generatedAt` is the SERVER's clock, carried through the snapshot verbatim.
 * Stamping it on read would make every restored payload look brand new, which is
 * precisely the "no presentarla como actualizada" the issue forbids.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { locationKey, type HomeSection, type LocationSelection, type Property } from '@homiio/shared-types';

import { fetchHomeSections } from '@/services/homeSectionsService';
import {
  readHomeSnapshot,
  useHomeSectionsCacheStore,
  type HomeSnapshot,
} from '@/store/homeSectionsCacheStore';

/** Beyond this age, a payload is presented as out of date rather than current. */
export const STALE_AFTER_MS = 1000 * 60 * 30;

/** How long a fetched surface is served without a background refetch. */
const HOME_SECTIONS_STALE_TIME_MS = 1000 * 60 * 2;

export type HomeDataFreshness = 'live' | 'cached' | 'stale';

/** The query key for a scope. Exported so a test can assert it, not re-derive it. */
export function homeSectionsQueryKey(
  selection: LocationSelection | null,
  offering: string,
): QueryKey {
  return ['homeSections', locationKey(selection), offering];
}

export interface HomeSectionsResult {
  readonly sections: readonly HomeSection<Property>[];
  /** The SERVER's timestamp for the payload being shown, or null when there is none. */
  readonly generatedAt: string | null;
  readonly freshness: HomeDataFreshness;
  /** The timestamp to show beside a "not current" notice, or null when live. */
  readonly staleAt: string | null;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: Error | null;
  /** Refetch THIS scope. Never re-resolves the location. */
  readonly refresh: () => Promise<void>;
}

/**
 * Decide the freshness of what is on screen.
 *
 * A pure function taking the four facts it needs, so the three-way distinction
 * can be asserted directly. Written as one function rather than three flags
 * because the states are exclusive and computing them separately is how a
 * surface ends up claiming to be live and stale at once.
 */
export function resolveFreshness(input: {
  readonly hasLiveData: boolean;
  readonly servedFromSnapshot: boolean;
  readonly failed: boolean;
  readonly ageMs: number | null;
}): HomeDataFreshness {
  if (input.servedFromSnapshot) return 'cached';
  if (!input.hasLiveData) return 'live';
  // A failed refresh over data we already hold: the data is real, it is just no
  // longer known to be current, and saying "live" would be a claim we cannot
  // make. Distinct from `cached`, which is about WHERE it came from.
  if (input.failed) return 'stale';
  if (input.ageMs !== null && input.ageMs > STALE_AFTER_MS) return 'stale';
  return 'live';
}

export function useHomeSections(
  selection: LocationSelection | null,
  offering: string,
  options: { readonly enabled: boolean },
): HomeSectionsResult {
  const snapshot = useHomeSectionsCacheStore((s) => s.snapshot);
  const scopeKey = locationKey(selection);

  const query = useQuery({
    queryKey: homeSectionsQueryKey(selection, offering),
    queryFn: async () => {
      const payload = await fetchHomeSections(selection, offering);
      // Written under the key it was fetched FOR, so a later launch cannot serve
      // it for a different area. `locationKey` is recomputed here rather than
      // closed over, so the stored key and the query key are the same function
      // of the same selection.
      useHomeSectionsCacheStore.getState().save({
        locationKey: scopeKey,
        offering,
        generatedAt: payload.generatedAt,
        sections: payload.sections,
      });
      return payload;
    },
    enabled: options.enabled,
    staleTime: HOME_SECTIONS_STALE_TIME_MS,
    retry: 1,
  });

  const restored: HomeSnapshot | null = useMemo(
    () => (query.data ? null : readHomeSnapshot(snapshot, scopeKey, offering)),
    [query.data, snapshot, scopeKey, offering],
  );

  const generatedAt = query.data?.generatedAt ?? restored?.generatedAt ?? null;
  const freshness = resolveFreshness({
    hasLiveData: query.data !== undefined,
    servedFromSnapshot: restored !== null,
    failed: query.isError,
    ageMs: generatedAt ? Date.now() - new Date(generatedAt).getTime() : null,
  });

  const refresh = useCallback(async () => {
    // Refetches the SAME key. The location ladder is untouched, so the scope
    // after a refresh is the scope before it — the acceptance criterion, met by
    // not doing something rather than by re-checking afterwards.
    await query.refetch();
  }, [query]);

  return {
    sections: query.data?.sections ?? restored?.sections ?? [],
    generatedAt,
    freshness,
    staleAt: freshness === 'live' ? null : generatedAt,
    // Only a load with NOTHING to show is a loading state. Holding a snapshot
    // while the network answers is not: showing a skeleton over data we already
    // have is a worse experience and hides the cached notice.
    isLoading: query.isPending && restored === null && options.enabled,
    isRefreshing: query.isFetching && (query.data !== undefined || restored !== null),
    error: query.error instanceof Error ? query.error : null,
    refresh,
  };
}
