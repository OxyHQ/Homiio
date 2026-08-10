/**
 * The ONE client for Homiio's geo gateway.
 *
 * Every place lookup in the app goes through here: autocomplete, resolving a
 * `loc` token from a deep link, and reverse geocoding a map pin. There is no
 * per-feature geocoding service and no direct call to a provider from a device
 * — see `__tests__/noClientGeocoder.test.ts`, which fails the build if one
 * comes back.
 *
 * The reasons, from ADR 0002 §9.1, in the order they cost us something:
 *
 *  - a per-device call cannot be rate-limited, cached or attributed, and the
 *    OSM policy counts every one of them against Homiio;
 *  - the client sent a user's typing, and sometimes their position, straight to
 *    a third party;
 *  - a browser refuses to let JavaScript set `User-Agent`, and the public
 *    endpoint rejects requests without one — so native returned zero
 *    suggestions while web worked, for months;
 *  - swapping provider meant editing code already shipped to phones.
 *
 * ## Failures keep their identity
 *
 * Every function here throws {@link GeoRequestError} carrying a
 * {@link GeoFailureReason}, and NONE of them returns an empty list when the
 * gateway failed. That is the whole point of the contract: a screen that reads
 * a timeout as "nowhere matched" will drop the location filter and show a
 * global feed, which looks like a working app returning the wrong homes.
 */

import { api, ApiError, type ApiResponse } from '@/utils/api';
import type { GeoPlace } from '@homiio/shared-types';

/**
 * Why a geo request failed, as the set the UI actually branches on.
 *
 * `too_ambiguous` is not here: "many candidates" is a successful response the
 * picker renders as a disambiguation list, not an error.
 */
export type GeoFailureReason =
  | 'offline'
  | 'rate_limited'
  | 'timeout'
  | 'provider_unavailable'
  | 'not_found'
  | 'invalid_request'
  | 'unknown';

export class GeoRequestError extends Error {
  readonly reason: GeoFailureReason;
  /** Seconds to wait, when the gateway said. Never a guessed backoff. */
  readonly retryAfterSeconds?: number;

  constructor(reason: GeoFailureReason, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'GeoRequestError';
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** What the surface showing these results must display. ODbL requires it. */
export interface GeoAttribution {
  readonly text: string;
  readonly url: string;
}

export interface GeoSearchResult {
  readonly candidates: GeoPlace[];
  /** True when a fallback provider answered. The UI may say results are degraded. */
  readonly degraded: boolean;
  readonly attribution?: GeoAttribution;
}

/**
 * The gateway's payload.
 *
 * `degraded` and `attribution` are siblings of the data rather than envelope
 * metadata, because the linked client discards anything in `meta` in transit
 * (see the controller's note). Losing the attribution would be a licence
 * problem, not a cosmetic one.
 */
interface GeoSearchPayload {
  candidates?: GeoPlace[];
  degraded?: boolean;
  attribution?: GeoAttribution;
}

interface GeoPlacePayload {
  place?: GeoPlace;
  degraded?: boolean;
  attribution?: GeoAttribution;
}

const STATUS_REASON: Readonly<Record<number, GeoFailureReason>> = {
  400: 'invalid_request',
  404: 'not_found',
  429: 'rate_limited',
  503: 'provider_unavailable',
  504: 'timeout',
};

/**
 * Turn a transport failure into a typed reason.
 *
 * A request that never reached a STATUS is `offline` — the honest reading on a
 * device, and the one case where retrying immediately is pointless while
 * retrying on reconnect is exactly right. `utils/api.ts` wraps every failure as
 * an `ApiError` carrying that status.
 */
function toGeoError(error: unknown): GeoRequestError {
  if (error instanceof GeoRequestError) return error;

  const status = error instanceof ApiError ? error.status : undefined;
  if (typeof status !== 'number') {
    return new GeoRequestError('offline', 'Could not reach Homiio');
  }
  return new GeoRequestError(STATUS_REASON[status] ?? 'unknown', 'Place lookup failed');
}

export interface GeoSearchParams {
  readonly q: string;
  /** ISO-3166-1 alpha-2. Restricts results to one country. */
  readonly countryCode?: string;
  /** Place types to keep, e.g. `['city', 'neighborhood']`. */
  readonly types?: readonly string[];
  /** A point to BIAS towards. Never a filter — another country stays reachable. */
  readonly near?: { readonly longitude: number; readonly latitude: number };
  /** Capped at 10 by the gateway. */
  readonly limit?: number;
  readonly language?: string;
}

/**
 * Candidates for a typed query — ALWAYS a list.
 *
 * It never auto-picks. There are two cities called Barcelona, and choosing one
 * on the user's behalf is how a search silently runs against Venezuela.
 */
export async function searchPlaces(params: GeoSearchParams): Promise<GeoSearchResult> {
  try {
    const { data: result } = await api.get<ApiResponse<GeoSearchPayload>>('/api/geo/search', {
      params: {
        q: params.q,
        ...(params.countryCode ? { countryCode: params.countryCode } : {}),
        ...(params.types?.length ? { types: params.types.join(',') } : {}),
        ...(params.near ? { near: `${params.near.longitude},${params.near.latitude}` } : {}),
        ...(params.limit ? { limit: params.limit } : {}),
        ...(params.language ? { language: params.language } : {}),
      },
      requireAuth: false,
    });

    return {
      candidates: result.data?.candidates ?? [],
      degraded: Boolean(result.data?.degraded),
      ...(result.data?.attribution ? { attribution: result.data.attribution } : {}),
    };
  } catch (error) {
    throw toGeoError(error);
  }
}

/**
 * Resolve a `loc` token to the place it names.
 *
 * Throws `not_found` rather than returning null, because an unresolvable token
 * in a shared link is a FAILURE the screen must show — never an absence it may
 * quietly ignore by falling back to everything (ADR §5.2).
 */
export async function resolvePlace(loc: string, language?: string): Promise<GeoPlace> {
  try {
    const { data: result } = await api.get<ApiResponse<GeoPlacePayload>>('/api/geo/resolve', {
      params: { loc, ...(language ? { language } : {}) },
      requireAuth: false,
    });
    const place = result.data?.place;
    if (!place) throw new GeoRequestError('not_found', 'That place could not be resolved');
    return place;
  } catch (error) {
    throw toGeoError(error);
  }
}

/** The place a coordinate falls in. */
export async function reversePlace(
  longitude: number,
  latitude: number,
  language?: string,
): Promise<GeoPlace> {
  try {
    const { data: result } = await api.get<ApiResponse<GeoPlacePayload>>('/api/geo/reverse', {
      params: { lng: longitude, lat: latitude, ...(language ? { language } : {}) },
      requireAuth: false,
    });
    const place = result.data?.place;
    if (!place) throw new GeoRequestError('not_found', 'No place found at those coordinates');
    return place;
  } catch (error) {
    throw toGeoError(error);
  }
}
