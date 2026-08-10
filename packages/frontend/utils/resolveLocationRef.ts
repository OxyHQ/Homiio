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
 */
import {
  type AdminHierarchy,
  type City,
  type LocationRef,
  type LocationResolution,
  type LocationSelection,
  type PlaceLabel,
} from '@homiio/shared-types';

import { cityService } from '@/services/cityService';
import { cityCountry, cityCountryName, cityRegionName } from '@/utils/cityDisplay';

/** A device fix, supplied by the caller — this module never asks for one. */
export interface DeviceFix {
  latitude: number;
  longitude: number;
}

/** Build the label + admin hierarchy for a canonical Homiio city. */
function cityIdentity(city: City): { label: PlaceLabel; admin: AdminHierarchy } {
  const region = cityRegionName(city);
  const country = cityCountryName(city);
  return {
    label: {
      primary: city.name,
      // Pre-split, and joined for display only at the point of rendering. The
      // parent is what tells "Barcelona, Catalonia, Spain" from "Barcelona,
      // Anzoátegui, Venezuela" at a glance, so it is never dropped.
      secondary: [region, country].filter(Boolean).join(', ') || undefined,
      kind: 'place',
    },
    admin: {
      // ISO-3166-1 alpha-2, read off the POPULATED country rather than guessed.
      // There is deliberately no default: `cityService.getCityByLocation` used
      // to default the country to `'USA'`, which is how a lookup for a city
      // that exists in several countries lands confidently in the wrong one.
      // Empty means "not known", which a consumer can see; a wrong code is
      // indistinguishable from a right one.
      countryCode: cityCountry(city)?.code ?? '',
      regionName: region || undefined,
      cityName: city.name,
    },
  };
}

/** Build a `place` selection from a resolved canonical city. */
export function citySelection(city: City): LocationSelection | null {
  const coordinates = city.coordinates;
  if (!coordinates) return null;
  const { label, admin } = cityIdentity(city);
  return {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id: city.id },
    placeType: 'city',
    label,
    admin,
    center: { longitude: coordinates.lng, latitude: coordinates.lat },
    // No bounds: the canonical `City` record carries a centroid and no extent,
    // so there is nothing honest to put here. A synthetic box around the centre
    // would be a fabrication — the same one deleted from `WhereStep`, where a
    // fixed +/-0.05 degree square stood in for the extent of anywhere from a
    // hamlet to Tokyo. A city with no bounds is scoped by `city=<id>` anyway,
    // which is the canonical id and better than any box.

    // A city's centre is the representative point of an AREA and is nobody's
    // address. Declaring that is what stops a consumer treating it as a home's
    // position — a distinction no type used to carry at all.
    precision: 'centroid',
  };
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
      try {
        const response = await cityService.getCityById(ref.id);
        const city = response?.data;
        if (!city) return { status: 'failed', reason: 'no_results' };
        const selection = citySelection(city);
        return selection
          ? { status: 'resolved', selection }
          : { status: 'failed', reason: 'no_results' };
      } catch {
        return { status: 'failed', reason: 'network' };
      }
    }

    case 'point':
      // §5.2 defines `at.` and §3 has no selection kind for it, so a token that
      // parses still has nowhere to land. Refused rather than approximated.
      return { status: 'failed', reason: 'unsupported' };

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
 * The rule that matters is what happens with more than one match: it opens the
 * disambiguation list and commits NOTHING. `getCityBySlug` used to end in
 * `searchCities(name, 1).data[0]` — take the first — and the backend ordered
 * candidates by listing count, so whichever Barcelona had more listings won,
 * arbitrarily from the user's point of view, and the winner could change as
 * data arrived.
 */
export async function resolveLegacyCityParam(value: string): Promise<LocationResolution> {
  try {
    const response = await cityService.getCityBySlug(value);
    const city = response?.data;
    if (!city) return { status: 'failed', reason: 'no_results' };
    const selection = citySelection(city);
    return selection
      ? { status: 'resolved', selection }
      : { status: 'failed', reason: 'no_results' };
  } catch {
    return { status: 'failed', reason: 'network' };
  }
}
