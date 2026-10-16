/**
 * Place autocomplete, through Homiio's geo gateway.
 *
 * There is no geocoder client here any more. Everything below calls
 * `services/geoService.ts`, which calls `/api/geo/*`, which is the only thing
 * in the system that talks to a provider (ADR 0002 §9.1, issue #351). The gate
 * in `__tests__/noClientGeocoder.test.ts` fails the build if a direct call
 * returns.
 *
 * ## The states a caller has to be able to tell apart
 *
 * {@link AddressSearchState} exists because "no suggestions" was previously the
 * answer to five different questions: the user has not typed enough yet, the
 * request is in flight, nothing matched, the provider timed out, and we are
 * offline. A screen that cannot distinguish them shows "no results" for a
 * network failure — and a screen that then drops the location filter shows a
 * global feed, which looks like a working app returning the wrong homes.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GeoPlace } from '@homiio/shared-types';

import {
  GeoRequestError,
  searchPlaces,
  type GeoAttribution,
  type GeoFailureReason,
} from '@/services/geoService';

export interface AddressSearchOptions {
  minQueryLength?: number;
  debounceDelay?: number;
  maxResults?: number;
  /** ISO-3166-1 alpha-2. Restricts results to one country. */
  countryCode?: string;
  /** Place types to keep, e.g. `['city', 'neighborhood']`. */
  types?: readonly string[];
}

/**
 * What the picker is doing, as a discriminated union rather than three
 * independent booleans.
 *
 * Three booleans admit states that cannot happen (loading AND failed) and, more
 * importantly, admit the one that silently did: `results: []` with no way to
 * say why.
 */
export type AddressSearchState =
  /** Below the minimum query length — show recents, not "no results". */
  | { readonly status: 'idle' }
  /** A keystroke landed; the request has not been sent yet. */
  | { readonly status: 'debouncing' }
  | { readonly status: 'loading' }
  | { readonly status: 'results'; readonly places: GeoPlace[]; readonly degraded: boolean }
  /** The provider answered, and the answer was nothing. */
  | { readonly status: 'empty' }
  | {
      readonly status: 'failed';
      readonly reason: GeoFailureReason;
      readonly retryAfterSeconds?: number;
    };

export interface UseAddressSearchReturn {
  readonly state: AddressSearchState;
  /** The attribution the provider requires be displayed beside its results. */
  readonly attribution?: GeoAttribution;
  readonly search: (query: string) => void;
  readonly clear: () => void;
}

const DEFAULTS = {
  minQueryLength: 2,
  debounceDelay: 300,
  maxResults: 6,
} as const;

/**
 * Place autocomplete against the gateway.
 *
 * The lookup is a React Query keyed on the submitted text, so a superseded
 * response can never replace the current one: a slow answer for "Bar" lands in
 * the cache under "Bar" and is simply not what the screen is reading once the
 * query is "Barcelona". That is not merely a nicety — without it the
 * autocomplete reads as wrong rather than late.
 */
const useAddressSearch = (options: AddressSearchOptions = {}): UseAddressSearchReturn => {
  const {
    minQueryLength = DEFAULTS.minQueryLength,
    maxResults = DEFAULTS.maxResults,
    countryCode,
    types,
  } = options;

  const [query, setQuery] = useState('');
  const typesKey = types?.join(',') ?? '';
  const enabled = query.length >= minQueryLength;

  const lookup = useQuery({
    queryKey: ['geo', 'search', query, maxResults, countryCode ?? null, typesKey],
    queryFn: () =>
      searchPlaces({
        q: query,
        limit: maxResults,
        ...(countryCode ? { countryCode } : {}),
        ...(typesKey ? { types: typesKey.split(',') } : {}),
      }),
    enabled,
    // A failure is surfaced as-is (a rate limit must not be retried into).
    retry: false,
  });

  const { data, error } = lookup;
  const state = useMemo<AddressSearchState>(() => {
    if (!enabled) return { status: 'idle' };
    if (data) {
      return data.candidates.length > 0
        ? { status: 'results', places: data.candidates, degraded: data.degraded }
        : { status: 'empty' };
    }
    if (error) {
      // A failure is NEVER reported as an empty list.
      const geoError = error instanceof GeoRequestError ? error : null;
      return {
        status: 'failed',
        reason: geoError?.reason ?? 'unknown',
        ...(geoError?.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: geoError.retryAfterSeconds }),
      };
    }
    return { status: 'loading' };
  }, [enabled, data, error]);
  const attribution = enabled ? data?.attribution : undefined;

  const search = useCallback((next: string) => setQuery(next.trim()), []);
  const clear = useCallback(() => setQuery(''), []);

  return useMemo(
    () => ({ state, search, clear, ...(attribution ? { attribution } : {}) }),
    [state, search, clear, attribution],
  );
};

/**
 * {@link useAddressSearch} with the keystroke debounce attached.
 *
 * The debounce is a courtesy to the provider and to the user's data plan; it is
 * NOT a control. The gateway enforces the real minimum and maximum query
 * length, the result cap and the per-caller rate limit, because a debounce is
 * absent from a script, a replay, or an app binary somebody shipped last year.
 */
export const useDebouncedAddressSearch = (
  options: AddressSearchOptions = {},
): UseAddressSearchReturn & { readonly debouncedSearch: (query: string) => void } => {
  const { debounceDelay = DEFAULTS.debounceDelay, ...searchOptions } = options;
  const minQueryLength = searchOptions.minQueryLength ?? DEFAULTS.minQueryLength;

  const inner = useAddressSearch(searchOptions);
  const { search, clear: clearInner } = inner;

  // Distinguishes "the user just typed and we are waiting out the debounce"
  // from "idle", so the picker can show a spinner from the first keystroke
  // instead of appearing frozen for `debounceDelay`.
  const [isDebouncing, setIsDebouncing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The debounce runs in the keystroke handler itself: each keystroke restarts
  // the timer, and the timer submits the text it was started with.
  const debouncedSearch = useCallback(
    (query: string) => {
      clearTimeout(timer.current);
      setIsDebouncing(true);
      timer.current = setTimeout(() => {
        setIsDebouncing(false);
        if (query.trim().length >= minQueryLength) {
          search(query);
        } else {
          clearInner();
        }
      }, debounceDelay);
    },
    [debounceDelay, minQueryLength, search, clearInner],
  );

  // Clearing also drops a keystroke still waiting out the debounce, so it
  // cannot fire afterwards and repopulate the list.
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setIsDebouncing(false);
    clearInner();
  }, [clearInner]);

  return useMemo(
    () => ({
      ...inner,
      clear,
      state: isDebouncing && inner.state.status === 'idle' ? { status: 'debouncing' } : inner.state,
      debouncedSearch,
    }),
    [inner, clear, isDebouncing, debouncedSearch],
  );
};
