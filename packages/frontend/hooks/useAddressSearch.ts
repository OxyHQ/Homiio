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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  readonly search: (query: string) => Promise<void>;
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
 * Requests are sequenced rather than cancelled: `utils/api.ts` does not expose
 * an `AbortSignal`, so a superseded response is DISCARDED on arrival by
 * comparing a monotonic request id. That is not merely a nicety — without it a
 * slow response for "Bar" can land after a fast one for "Barcelona" and replace
 * the correct suggestions with stale ones, which reads as the autocomplete
 * being wrong rather than late.
 */
export const useAddressSearch = (options: AddressSearchOptions = {}): UseAddressSearchReturn => {
  const {
    minQueryLength = DEFAULTS.minQueryLength,
    maxResults = DEFAULTS.maxResults,
    countryCode,
    types,
  } = options;

  const [state, setState] = useState<AddressSearchState>({ status: 'idle' });
  const [attribution, setAttribution] = useState<GeoAttribution | undefined>(undefined);

  const latestRequest = useRef(0);
  // A ref so the identity of `search` does not change when a request completes.
  const isMounted = useRef(true);
  useEffect(
    () => () => {
      isMounted.current = false;
    },
    [],
  );

  const typesKey = types?.join(',') ?? '';

  const search = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      const requestId = latestRequest.current + 1;
      latestRequest.current = requestId;

      if (trimmed.length < minQueryLength) {
        setState({ status: 'idle' });
        return;
      }

      setState({ status: 'loading' });
      try {
        const result = await searchPlaces({
          q: trimmed,
          limit: maxResults,
          ...(countryCode ? { countryCode } : {}),
          ...(typesKey ? { types: typesKey.split(',') } : {}),
        });
        // A superseded or unmounted request must not write.
        if (!isMounted.current || latestRequest.current !== requestId) return;

        if (result.attribution) setAttribution(result.attribution);
        setState(
          result.candidates.length > 0
            ? { status: 'results', places: result.candidates, degraded: result.degraded }
            : { status: 'empty' },
        );
      } catch (error) {
        if (!isMounted.current || latestRequest.current !== requestId) return;
        // A failure is NEVER reported as an empty list.
        const geoError = error instanceof GeoRequestError ? error : null;
        setState({
          status: 'failed',
          reason: geoError?.reason ?? 'unknown',
          ...(geoError?.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: geoError.retryAfterSeconds }),
        });
      }
    },
    [minQueryLength, maxResults, countryCode, typesKey],
  );

  const clear = useCallback(() => {
    // Bump the sequence so an in-flight response cannot repopulate the list
    // after the user cleared it.
    latestRequest.current += 1;
    setState({ status: 'idle' });
  }, []);

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
  const { search, clear } = inner;

  const [pending, setPending] = useState('');
  // Distinguishes "the user just typed and we are waiting out the debounce"
  // from "idle", so the picker can show a spinner from the first keystroke
  // instead of appearing frozen for `debounceDelay`.
  const [isDebouncing, setIsDebouncing] = useState(false);

  useEffect(() => {
    if (!isDebouncing) return undefined;
    const timer = setTimeout(() => {
      setIsDebouncing(false);
      if (pending.trim().length >= minQueryLength) {
        void search(pending);
      } else {
        clear();
      }
    }, debounceDelay);
    return () => clearTimeout(timer);
  }, [pending, isDebouncing, debounceDelay, minQueryLength, search, clear]);

  const debouncedSearch = useCallback((query: string) => {
    setPending(query);
    setIsDebouncing(true);
  }, []);

  return useMemo(
    () => ({
      ...inner,
      state: isDebouncing && inner.state.status === 'idle' ? { status: 'debouncing' } : inner.state,
      debouncedSearch,
    }),
    [inner, isDebouncing, debouncedSearch],
  );
};
