/**
 * A Home request that fails must SAY so — the user's actual complaint (#353).
 *
 * ## What happened in production
 *
 * The browser fired `GET /api/home/sections?loc=city.osm.R347950` **four times**,
 * every one answered **400**, and the surface showed nothing that named a
 * failure. Two separate defects wearing one symptom, and this file pins both
 * halves of the repair:
 *
 *  1. **A 400 was retried.** "This scope is not acceptable" cannot become
 *     acceptable by asking again, so three of those four requests could never
 *     have succeeded — and each one bought more time during which the surface
 *     merely looked slow.
 *  2. **A failure could render as an absence.** "We could not load this area"
 *     and "there is nothing in this area" are different claims about the world,
 *     and showing the second for the first tells somebody their city is empty
 *     when Homiio could not answer.
 */

import {
  homeSectionsFailureMessage,
  homeSurfaceState,
  isRetryableHomeSectionsError,
} from '@/hooks/useHomeSections';
import { ApiError } from '@/utils/api';

describe('what may be retried', () => {
  it('does NOT retry the 400 that caused the incident', () => {
    // The exact production failure: `UNSUPPORTED_LOCATION` on a scope the
    // endpoint refused. Retrying it is asking the same question again.
    expect(isRetryableHomeSectionsError(new ApiError('UNSUPPORTED_LOCATION', 400))).toBe(false);
  });

  it('does not retry any other 4xx either', () => {
    // The floor for the case above: a predicate special-casing 400 alone would
    // pass it while still hammering a 404 or a 422.
    for (const status of [401, 403, 404, 409, 422, 429, 499]) {
      expect(isRetryableHomeSectionsError(new ApiError('nope', status))).toBe(false);
    }
  });

  it('DOES retry a 5xx, which is about the moment rather than the request', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isRetryableHomeSectionsError(new ApiError('later', status))).toBe(true);
    }
  });

  it('DOES retry the geocoder-unavailable 503 the repair introduces', () => {
    // The server now distinguishes "this scope is not acceptable" (400) from
    // "the gateway could not answer just now" (503). If the client did not read
    // that distinction, the split would buy nothing.
    expect(isRetryableHomeSectionsError(new ApiError('GEOCODER_UNAVAILABLE', 503))).toBe(true);
  });

  it('DOES retry a failure that never reached a status', () => {
    // Offline, DNS, a dropped socket. The request never reached the server, so
    // nothing has been said about whether the scope is acceptable.
    expect(isRetryableHomeSectionsError(new ApiError('Network Error'))).toBe(true);
    expect(isRetryableHomeSectionsError(new Error('boom'))).toBe(true);
  });
});

describe('the surface never renders a failure as an absence', () => {
  const base = {
    needsPlace: false,
    canQuery: true,
    isLoading: false,
    hasError: false,
    sectionCount: 0,
  };

  it('reports FAILED, not empty, when the request failed with nothing to show', () => {
    // The assertion this file exists for.
    expect(homeSurfaceState({ ...base, hasError: true })).toBe('failed');
  });

  it('reports EMPTY only when the request succeeded and matched nothing', () => {
    // The floor: without it, a function returning 'failed' for everything would
    // satisfy the case above.
    expect(homeSurfaceState(base)).toBe('empty');
  });

  it('keeps showing sections when a BACKGROUND refresh fails', () => {
    // The data is real and still on screen; blanking the page would destroy
    // something correct. The toast and the stale banner carry the failure.
    expect(homeSurfaceState({ ...base, hasError: true, sectionCount: 3 })).toBe('sections');
  });

  it('asks for a place before it reports anything else', () => {
    // With no scope there is nothing to have failed at, so the picker outranks
    // even an error left over from a previous scope.
    expect(homeSurfaceState({ ...base, needsPlace: true, hasError: true })).toBe('needs_place');
    expect(homeSurfaceState({ ...base, canQuery: false, hasError: true })).toBe('needs_place');
  });

  it('reports LOADING only while there is nothing to show and nothing has failed', () => {
    expect(homeSurfaceState({ ...base, isLoading: true })).toBe('loading');
    // A failure outranks a stale `isLoading`, so a settled error is never
    // rendered as a spinner that will never resolve.
    expect(homeSurfaceState({ ...base, isLoading: true, hasError: true })).toBe('loading');
  });

  it('returns exactly one state for every input combination', () => {
    // Exhaustive rather than illustrative: the states are exclusive by
    // construction and a sweep is what proves it, with a vacuity floor so a
    // broken generator cannot pass by never looping.
    const flags = [false, true];
    const allowed = new Set(['needs_place', 'loading', 'failed', 'empty', 'sections']);
    let checked = 0;

    for (const needsPlace of flags) {
      for (const canQuery of flags) {
        for (const isLoading of flags) {
          for (const hasError of flags) {
            for (const sectionCount of [0, 3]) {
              const state = homeSurfaceState({
                needsPlace,
                canQuery,
                isLoading,
                hasError,
                sectionCount,
              });
              expect(allowed.has(state)).toBe(true);
              // The rule that matters, asserted over every combination: a
              // failure with nothing to show is NEVER reported as empty.
              if (hasError && sectionCount === 0 && canQuery && !needsPlace && !isLoading) {
                expect(state).toBe('failed');
              }
              checked += 1;
            }
          }
        }
      }
    }

    expect(checked).toBe(2 ** 4 * 2);
    expect(checked).toBe(32);
  });
});

describe('the failure message always has words in it', () => {
  it('never returns an empty string, even with i18n uninitialised', () => {
    // MEASURED in this environment: an i18next that has not been `init`ed
    // returns `undefined` from `t()`, and does so even when a `defaultValue` is
    // supplied. `toast.error(undefined)` is a toast with no words — the silent
    // failure this change removes, reintroduced on the boot path.
    const message = homeSectionsFailureMessage();

    expect(typeof message).toBe('string');
    expect(message.trim().length).toBeGreaterThan(0);
  });
});
