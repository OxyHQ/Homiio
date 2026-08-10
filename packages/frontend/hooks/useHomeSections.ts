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

import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import i18next from 'i18next';
import { toast } from '@oxyhq/bloom/toast';
import { locationKey, type HomeSection, type LocationSelection, type Property } from '@homiio/shared-types';

import { ApiError } from '@/utils/api';
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

/**
 * Attempts after the first, for a failure that retrying can actually fix.
 *
 * Two, not four. The production incident fired the SAME doomed request four
 * times against a 400 and showed the user nothing — four attempts at an answer
 * that could not change, and four chances for the surface to look merely slow.
 */
const HOME_SECTIONS_MAX_RETRIES = 2;

/**
 * The words shown when i18n has not loaded yet.
 *
 * Deliberately the same sentence as `home.sections.loadFailedToast` in
 * `en.json`; the key is the copy, and this is the guarantee that SOMETHING is
 * said even when the key cannot be resolved.
 */
const HOME_SECTIONS_FAILED_FALLBACK =
  'Could not load homes for this area. Nothing is hidden — the request failed.';

/**
 * The failure message, guaranteed to have words in it.
 *
 * MEASURED, in this repo's own jest environment: an i18next that has not been
 * `init`ed returns `undefined` from `t()` — and it does so **even when a
 * `defaultValue` is supplied**, because the pre-init `t` is a stub that never
 * looks at its options. So `defaultValue` is not the guard it appears to be, and
 * the floor has to be applied here.
 *
 * It matters because `toast.error(undefined)` is a toast with no words in it:
 * the silent failure this whole change exists to remove, reintroduced one layer
 * down and only on the boot path, where nobody would look for it.
 */
export function homeSectionsFailureMessage(): string {
  const translated = i18next.t('home.sections.loadFailedToast');
  return typeof translated === 'string' && translated.trim().length > 0
    ? translated
    : HOME_SECTIONS_FAILED_FALLBACK;
}

/**
 * Whether retrying could plausibly succeed.
 *
 * A **4xx is a statement about the REQUEST** — this scope is not acceptable —
 * and no number of identical retries will make it acceptable. A 5xx, or a
 * failure with no status at all (the transport never reached one), is about the
 * moment, and that is exactly what a retry is for.
 *
 * Exported because it is the whole of the fix and belongs in a test that can
 * name a status, rather than inside an options object nothing can reach.
 */
export function isRetryableHomeSectionsError(error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : undefined;
  // No status: the request never reached the server. Retrying on reconnect is
  // the correct behaviour, and it is the one case where an immediate retry is
  // also cheap.
  if (typeof status !== 'number') return true;
  if (status >= 400 && status < 500) return false;
  return true;
}

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
    retry: (failureCount, error) =>
      failureCount < HOME_SECTIONS_MAX_RETRIES && isRetryableHomeSectionsError(error),
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

  /**
   * ONE message per distinct failure, and never one per retry.
   *
   * The signature is a STRING built from the scope, the offering and the
   * message, so React Query's own retries — which do not change any of the
   * three — cannot re-fire it, and switching city after a failure legitimately
   * can. A ref-based "have I toasted yet" flag would have to be reset on every
   * scope change by hand, and the hand is what gets forgotten.
   *
   * An effect is the right tool here rather than a smell: a toast is an external
   * system, and updating an external system from React state is the one thing
   * effects are for.
   */
  const failureSignature = query.isError
    ? `${scopeKey}|${offering}|${query.error instanceof Error ? query.error.message : 'unknown'}`
    : null;

  useEffect(() => {
    if (failureSignature === null) return;
    // `i18next.t` rather than `useTranslation`'s `t`: the latter changes
    // identity on a language switch, which would re-toast an old failure the
    // moment somebody changed language.
    toast.error(homeSectionsFailureMessage());
  }, [failureSignature]);

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

/**
 * What the Home surface must render, as ONE exclusive answer.
 *
 * ## Why this is a function and not four booleans in the screen
 *
 * The production incident was a silent failure: four requests failed and the
 * user saw nothing that named a failure. The states are mutually exclusive and
 * the dangerous pair is `failed` and `empty` — "we could not load this area" and
 * "there is nothing in this area" are different claims about the world, and
 * rendering the second for the first tells somebody their city is empty when
 * Homiio simply could not answer.
 *
 * Expressed as four conditions in JSX, that distinction is one `&&` away from
 * being lost and cannot be tested without mounting the screen. Expressed here,
 * it is an ordinary assertion, and `failed` is ordered ABOVE `empty` so the
 * misleading claim is unreachable rather than merely discouraged.
 */
export type HomeSurfaceState = 'needs_place' | 'loading' | 'failed' | 'empty' | 'sections';

export function homeSurfaceState(input: {
  readonly needsPlace: boolean;
  readonly canQuery: boolean;
  readonly isLoading: boolean;
  readonly hasError: boolean;
  readonly sectionCount: number;
}): HomeSurfaceState {
  // The picker comes first: with no scope there is nothing to have failed at.
  if (input.needsPlace || !input.canQuery) return 'needs_place';
  // Then anything already fetched, so a failed BACKGROUND refresh over data we
  // still hold does not blank the page — the data is real, and the toast plus
  // the stale banner carry the failure.
  if (input.sectionCount > 0) return 'sections';
  if (input.isLoading) return 'loading';
  // BEFORE `empty`, and that order is the fix.
  if (input.hasError) return 'failed';
  return 'empty';
}
