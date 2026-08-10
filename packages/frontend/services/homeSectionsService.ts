/**
 * The client for `GET /api/home/sections` (#353).
 *
 * ## A scope that cannot be serialised is an ERROR, never a dropped parameter
 *
 * {@link buildHomeSectionsParams} throws when a committed selection has no `loc`
 * token — today `polygon`, whose wire format ADR 0002 §2.1 reserves, and any
 * provider ref carrying the `+` the grammar uses as a separator. Omitting `loc`
 * would be read by the server as "no location was requested" and answered
 * globally, which is the §4.3 failure this whole contract exists to prevent,
 * arriving through the one path nobody inspects: a missing query parameter.
 *
 * `utils/searchUrl.ts` makes the same call for the same reason, and returns
 * `null` rather than throwing because its caller renders a link. Here the caller
 * is a `queryFn`, so a throw is what reaches the UI as an error state — the
 * shape React Query already renders.
 */

import { api, type ApiResponse } from '@/utils/api';
import {
  serializeLocationToken,
  type HomeSectionsResponse,
  type LocationSelection,
  type Property,
} from '@homiio/shared-types';

/** A scope the grammar cannot express. Reaches the surface as an error state. */
export class UnscopableLocationError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`This area cannot be requested: ${reason}`);
    this.name = 'UnscopableLocationError';
    this.reason = reason;
  }
}

export interface HomeSectionsParams {
  readonly loc?: string;
  /** Present ONLY for a device scope — the token carries no coordinates. */
  readonly lat?: number;
  readonly lng?: number;
  readonly offering: string;
}

/**
 * The request parameters for a committed scope.
 *
 * `null` means the user chose "everywhere", explicitly. It is the only input
 * that produces a request with no `loc`, which is what keeps "no scope" a
 * decision rather than an accident.
 */
export function buildHomeSectionsParams(
  selection: LocationSelection | null,
  offering: string,
): HomeSectionsParams {
  if (!selection) return { offering };

  const token = serializeLocationToken(selection);
  if (!token.ok) throw new UnscopableLocationError(token.reason);

  if (selection.kind === 'current_location') {
    // Full precision in the REQUEST and nowhere else — ADR §8.3's device row.
    // The token beside it is `here.<radius>`, which carries no coordinate, so
    // nothing that gets cached, keyed or logged from this call can hold one.
    return {
      loc: token.value,
      lat: selection.center.latitude,
      lng: selection.center.longitude,
      offering,
    };
  }

  return { loc: token.value, offering };
}

/**
 * Fetch the whole Home surface.
 *
 * Transport failures PROPAGATE. `propertyService` records why in its own header
 * and it applies identically here: a caught error returning empty sections makes
 * a network failure, a 500 and a genuinely quiet neighbourhood produce the same
 * value, and the one the UI would render is the reassuring, wrong one.
 */
export async function fetchHomeSections(
  selection: LocationSelection | null,
  offering: string,
): Promise<HomeSectionsResponse<Property>> {
  const params = buildHomeSectionsParams(selection, offering);
  const { data: result } = await api.get<ApiResponse<HomeSectionsResponse<Property>>>(
    '/api/home/sections',
    { params, requireAuth: false },
  );
  const payload = result.data;
  if (!payload) throw new Error('The home sections response carried no data.');
  return payload;
}
