/**
 * The app-wide approximate area, resolved from the visitor's own connection.
 *
 * ## ONE resolution, shared by every surface
 *
 * Both epics forbid a per-widget fan-out in the same words: "No hacer una
 * llamada por tarjeta, widget o montaje: Home, Explore y las demás superficies
 * consumen una resolución compartida." That is what the fixed React Query key
 * below buys — every caller of this hook reads the same cache entry, so ten
 * mounts are one request.
 *
 * ## Why the answer is never persisted
 *
 * `staleTime`/`gcTime` are the contract's TTL, and the query client's disk
 * persister (if one is ever attached) must not hold this: an inferred city
 * written to disk is a record of where somebody's network was, sitting in a
 * store nothing expires. In memory it dies with the process, which is also what
 * makes moving between networks noticeable within one session rather than at
 * the next cold start.
 *
 * ## Enabled, and the one case where it is not
 *
 * The lookup runs unless an area is already in force. Asking the server where a
 * connection is, for a user who has already told us where they are looking, is
 * a request whose answer cannot be used — and the whole design is that an
 * inference never outranks a choice.
 */

import { useQuery } from '@tanstack/react-query';
import { APPROXIMATE_LOCATION_TTL_MS, type ApproximateLocation } from '@homiio/shared-types';

import { fetchApproximateLocation } from '@/services/approximateLocationService';
import type { ApproximatePositionState } from './locationScopeLadder';

/**
 * The key every surface shares. A constant, not a function of anything.
 *
 * There is deliberately nothing to key on: the answer is about the connection,
 * which is not a value this process can see. Keying on a language would split
 * the cache for a field that changes only labels, and keying on a screen would
 * reintroduce the fan-out.
 */
export const APPROXIMATE_LOCATION_QUERY_KEY = ['approximateLocation'] as const;

/**
 * How long the app waits for an answer before showing destinations.
 *
 * **1.5 seconds**, the budget #518 §3.3 proposes in those terms ("máximo 1,5
 * segundos para decidir el fallback automático"). It is a UX deadline and not a
 * request timeout: the request keeps going and, if it lands later, the ladder
 * picks it up — subject to the commit rule, so it can only take effect while
 * nothing else has.
 *
 * Exported so the test can assert against the same number the hook uses.
 */
export const APPROXIMATE_BUDGET_MS = 1_500;

export interface ApproximateLocationResult {
  readonly state: ApproximatePositionState;
  /** The raw answer, for a surface that wants to explain the provenance. */
  readonly data: ApproximateLocation | undefined;
}

/**
 * Translate the query's state into the ladder's input.
 *
 * A pure function taking the four facts, so "a failed lookup is `unavailable`
 * and never `resolving` forever" is an assertion rather than a render.
 * `elapsedBudget` is what turns a slow answer into discovery without cancelling
 * it: while the request is in flight and the budget has NOT elapsed the rung
 * reports `resolving` (the app shows a skeleton); once it has, the rung reports
 * `unavailable` and the destinations board appears — and a late answer still
 * lands, because the request was never aborted.
 */
export function approximateStateOf(input: {
  readonly enabled: boolean;
  readonly isPending: boolean;
  readonly elapsedBudget: boolean;
  readonly data: ApproximateLocation | undefined;
}): ApproximatePositionState {
  if (!input.enabled) return { status: 'idle' };
  if (input.data) {
    return input.data.status === 'resolved'
      ? {
          status: 'resolved',
          selection: input.data.selection,
          granularity: input.data.granularity,
        }
      : { status: 'unavailable' };
  }
  if (input.isPending && !input.elapsedBudget) return { status: 'resolving' };
  // Either the budget ran out or the query settled with nothing. Both mean the
  // app stops waiting; NEITHER cancels the request, so an answer arriving at
  // three seconds is still applied — subject to the ladder's commit rule, which
  // is what stops it from moving somebody who has started exploring.
  return { status: 'unavailable' };
}

export function useApproximateLocation(options: {
  readonly enabled: boolean;
  /**
   * Whether the shared startup budget has elapsed.
   *
   * Owned by {@link useLocationScope} and passed IN rather than timed here, for
   * two reasons. The budget covers the device rung too — "no encadenar primero
   * los 10 segundos actuales de GPS y después una llamada IP" — so one clock
   * has to govern both. And a timer living inside a query hook is the shape
   * that keeps a jest worker alive after the suite ends.
   */
  readonly budgetElapsed: boolean;
}): ApproximateLocationResult {
  const query = useQuery({
    queryKey: APPROXIMATE_LOCATION_QUERY_KEY,
    queryFn: fetchApproximateLocation,
    enabled: options.enabled,
    staleTime: APPROXIMATE_LOCATION_TTL_MS,
    gcTime: APPROXIMATE_LOCATION_TTL_MS,
    // `fetchApproximateLocation` never rejects — a transport failure becomes an
    // `unavailable` payload — so a retry policy here would have nothing to
    // retry. Said explicitly so nobody adds one expecting it to help.
    retry: false,
  });

  return {
    state: approximateStateOf({
      enabled: options.enabled,
      isPending: query.isPending,
      elapsedBudget: options.budgetElapsed,
      data: query.data,
    }),
    data: query.data,
  };
}
