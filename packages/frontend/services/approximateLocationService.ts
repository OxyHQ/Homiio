/**
 * The client for `GET /api/geo/approximate-location` (#518 §4, #519 §4).
 *
 * ## An unreachable server is `unavailable`, not an exception
 *
 * Every other geo call in this app propagates its failure, deliberately: a
 * search whose place could not be resolved must show an error rather than a
 * global feed. This one is the opposite, and the difference is what the caller
 * does with the answer.
 *
 * This is read on the first paint, before anybody asked for anything. Its
 * failure mode is "we could not guess your area", which is an outcome the app
 * already renders beautifully — the destinations board. Propagating would put a
 * red error state on the opening screen of somebody who has done nothing wrong
 * and asked for nothing, which is the blocking first impression both epics
 * exist to remove.
 *
 * So the transport failure is mapped onto the SAME `unavailable` the server
 * returns, and the reason distinguishes it for anybody looking. Nothing is
 * swallowed: the value is still a discriminated union and the caller still has
 * to handle both arms.
 */

import {
  type ApproximateLocation,
  type ApiResponse,
} from '@homiio/shared-types';

import { api } from '@/utils/api';

/**
 * Ask the server where this connection roughly is.
 *
 * `requireAuth: false` — the address is the transport's, not the session's, so
 * a token would add nothing but a reason for the call to fail when logged out,
 * which is exactly when it matters most.
 */
export async function fetchApproximateLocation(): Promise<ApproximateLocation> {
  try {
    const { data: result } = await api.get<ApiResponse<ApproximateLocation>>(
      '/api/geo/approximate-location',
      { requireAuth: false },
    );
    const payload = result.data;
    if (!payload) {
      return { status: 'unavailable', source: 'ip', reason: 'provider_error', resolvedAt: new Date().toISOString() };
    }
    return payload;
  } catch {
    // Offline, a 5xx, a DNS failure. All of them mean the same thing here.
    return {
      status: 'unavailable',
      source: 'ip',
      reason: 'provider_error',
      resolvedAt: new Date().toISOString(),
    };
  }
}
