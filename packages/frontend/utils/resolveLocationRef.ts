/**
 * Turn a parsed `loc` token into a committed {@link LocationSelection}.
 *
 * A token carries an IDENTITY and not a place: `city.homiio.<id>` says which
 * city, and says nothing about its name, its country or where it is. Those come
 * from resolving the id, which is the whole reason a token is worth more than a
 * label — the id still means the same city after it is renamed, and two cities
 * called Barcelona are two different tokens.
 *
 * ## Failure is a value here, never an absence
 *
 * Every exit is a {@link LocationResolution}. There is no `null` return and no
 * swallowed `catch`, because the single most damaging shape in the old code was
 * a failed lookup falling through to "no location" and running the query
 * unrestricted — the deep-link effect in `/explore` did exactly that, with a
 * comment explaining that the results would "fall back to the default published
 * feed". A person who asked for Barcelona then got a global list under a
 * Barcelona heading, with nothing anywhere saying the location had been
 * dropped.
 *
 * The reasons are distinguished because the UI must treat them differently: a
 * network failure offers a retry, `no_results` offers a different place, and
 * `ambiguous` opens the disambiguation list. Collapsing them into one "error"
 * is how a retry button appears on a query that will never succeed.
 *
 * ## `ambiguous` is a SUCCESSFUL answer that must not be resolved
 *
 * `cityService.lookupCity` (#295) answers `resolved` | `ambiguous` |
 * `not_found` and never picks between homonyms. This module maps `ambiguous`
 * onto `failed('ambiguous')` — "failed" in the sense that no single place was
 * determined, which is exactly what stops a query running. It must never take
 * `candidates[0]`: the old `getCityBySlug` ended in `searchCities(name, 1)[0]`
 * against a backend ordering by listing count, so whichever Barcelona had more
 * listings won, arbitrarily, and the winner could change as data arrived.
 */
import {
  type CityPlaceCandidate,
  type LocationRef,
  type LocationResolution,
  type LocationSelection,
} from '@homiio/shared-types';

import { cityService } from '@/services/cityService';

/** A device fix, supplied by the caller — this module never asks for one. */
export interface DeviceFix {
  latitude: number;
  longitude: number;
}

/**
 * Build a `place` selection from a resolved city candidate.
 *
 * The candidate already carries everything a selection needs — a pre-split
 * `label`, an explicit `admin` hierarchy, a declared `precision` and its
 * geometry — so nothing is re-derived here. In particular nothing joins or
 * splits a label on commas, which is the assumption that mangles every script
 * that does not order a place name that way.
 *
 * The geometry is assembled as a UNIT rather than field by field, because
 * `PlaceGeometry` is a two-member union: a real point carries `center` with a
 * point-class precision, an extent carries `precision: 'area'` and
 * `center?: never`. Copying `center` and `precision` across independently would
 * let this function reassemble the contradiction the union exists to forbid —
 * and that contradiction is not hypothetical, it is what made the gateway emit
 * `(0, 0)` for every country and put "Spain" over the Gulf of Guinea.
 */
export function citySelection(city: CityPlaceCandidate): LocationSelection {
  const identity = {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id: city.id },
    placeType: 'city',
    label: city.label,
    admin: city.admin,
  } as const;

  return city.precision === 'area' || city.center === undefined
    ? { ...identity, precision: 'area', bounds: city.bounds }
    : { ...identity, precision: city.precision, center: city.center, bounds: city.bounds };
}

/** Map a lookup outcome onto a resolution, without ever choosing a candidate. */
async function resolveCityToken(token: string): Promise<LocationResolution> {
  try {
    const result = await cityService.lookupCity(token);
    switch (result.status) {
      case 'resolved':
        return { status: 'resolved', selection: citySelection(result.place) };
      case 'ambiguous':
        // The server found several equally valid places and handed back the
        // ordered list. Taking the first is the homonym bug; asking is the
        // contract. Rendering that list is #354's.
        return { status: 'failed', reason: 'ambiguous' };
      case 'not_found':
        return { status: 'failed', reason: 'no_results' };
    }
  } catch {
    return { status: 'failed', reason: 'network' };
  }
}

/**
 * Resolve a parsed token.
 *
 * `deviceFix` is passed in rather than requested here so that a `here.` token
 * cannot silently trigger a permission prompt from inside what looks like a
 * pure lookup — and so a revoked permission surfaces as
 * `failed('permission_denied')` at the call site that owns the permission.
 */
export async function resolveLocationRef(
  ref: LocationRef,
  deviceFix: DeviceFix | null,
): Promise<LocationResolution> {
  switch (ref.kind) {
    case 'bounds':
      // A box needs nothing looked up: it IS its own answer. It also never
      // acquires a name — `map_bounds` carries a generated label by
      // construction, so there is no path by which panning the map produces
      // something that later reads as a place.
      return {
        status: 'resolved',
        selection: {
          kind: 'map_bounds',
          bounds: ref.bounds,
          center: {
            longitude: (ref.bounds.west + ref.bounds.east) / 2,
            latitude: (ref.bounds.south + ref.bounds.north) / 2,
          },
          label: { primary: 'search.summary.mapArea', kind: 'generated' },
          precision: 'area',
        },
      };

    case 'device':
      if (!deviceFix) return { status: 'failed', reason: 'position_unavailable' };
      return {
        status: 'resolved',
        selection: {
          kind: 'current_location',
          center: { longitude: deviceFix.longitude, latitude: deviceFix.latitude },
          radiusMeters: ref.radiusMeters,
          precision: 'exact',
        },
      };

    case 'place': {
      if (ref.source.kind !== 'homiio' || ref.placeType !== 'city') {
        // An external provider ref and the non-city entities need the geo
        // gateway (#351). Refusing is the honest answer until it exists —
        // guessing one would put a wrong place behind a correct-looking URL.
        return { status: 'failed', reason: 'unsupported' };
      }
      // The id goes through the SAME four-outcome lookup as a name. An id is an
      // identity match (`matchedOn: 'id'`) and resolves on its own, so this
      // costs nothing, and it leaves one resolution path to reason about rather
      // than two that can quietly acquire different homonym behaviour.
      return resolveCityToken(ref.id);
    }

    case 'multi':
      return { status: 'failed', reason: 'unsupported' };

    default: {
      const exhaustive: never = ref;
      return exhaustive;
    }
  }
}

/**
 * Resolve a LEGACY `?city=<slug|name|id>` parameter (ADR §5.3, one release).
 *
 * The same lookup as a `loc` token, because a legacy param is a weaker spelling
 * of the same question — and routing both through one function is what stops
 * the deep-link path acquiring different homonym behaviour from the canonical
 * one.
 */
export async function resolveLegacyCityParam(value: string): Promise<LocationResolution> {
  return resolveCityToken(value);
}
