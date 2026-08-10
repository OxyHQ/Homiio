/**
 * The ONE place a provider result becomes Homiio's public `GeoPlace`.
 *
 * Deliberately outside every adapter (ADR 0002 §9.2). An adapter that decided a
 * place's type would have to be edited every time Homiio's taxonomy moved, and
 * a raw provider payload would be one careless `res.json(place)` away from the
 * wire. Keeping the construction here means a provider swap is a change with no
 * public consequence, which is the whole portability claim.
 */

import type {
  AdminHierarchy,
  GeoBounds,
  GeoPlace,
  GeoPlaceType,
  LocationPrecision,
  PlaceLabel,
} from '@homiio/shared-types';

import { REQUESTABLE_PLACE_TYPES } from './validation';
import type { ProviderPlace } from './types';

/**
 * Nominatim's `addresstype` (and, failing that, `type`) onto `GeoPlaceType`.
 *
 * `addresstype` is the right input: it is already the "what level of place is
 * this" answer, whereas `class`/`type` describe the OSM tagging
 * (`boundary`/`administrative`) and say nothing about level. Anything this map
 * does not know becomes `address`, which is the conservative direction — an
 * unrecognised feature is treated as a specific point rather than promoted to
 * an area, and an area is the claim that would be wrong.
 */
const PLACE_TYPE_BY_ADDRESS_TYPE: Readonly<Record<string, GeoPlaceType>> = {
  country: 'country',

  state: 'region',
  province: 'region',
  region: 'region',
  county: 'region',
  state_district: 'region',

  city: 'city',
  town: 'city',
  village: 'city',
  hamlet: 'city',
  municipality: 'city',

  city_district: 'district',
  district: 'district',
  borough: 'district',

  suburb: 'neighborhood',
  neighbourhood: 'neighborhood',
  quarter: 'neighborhood',
  residential: 'neighborhood',

  postcode: 'postcode',
};

/**
 * Feature levels that name a BUILDING rather than an area or a line.
 *
 * Only these earn `exact`. A road-level result is a representative point on a
 * line, not a building, so calling it `exact` would let a consumer render it as
 * somebody's front door — the precise confusion `LocationPrecision` exists to
 * prevent.
 */
const BUILDING_LEVEL_TYPES: ReadonlySet<string> = new Set([
  'house',
  'house_number',
  'building',
  'address',
  'residential_building',
]);

export function placeTypeOf(place: ProviderPlace): GeoPlaceType {
  const level = place.rawAddressType ?? place.rawType ?? '';
  return PLACE_TYPE_BY_ADDRESS_TYPE[level] ?? 'address';
}

/**
 * What the returned coordinate MEANS.
 *
 * Every named area gets `centroid`, and the comment on `LocationPrecision` is
 * worth repeating because it is the whole point: a centroid is NOT anybody's
 * location. A city centre is a framing device, and code that treats it as a
 * home's position is wrong in a way no other type prevents.
 *
 * The return type EXCLUDES `'area'`, and that is a claim rather than a
 * convenience: an adapter only ever produces a place it found a finite
 * coordinate for (`toProviderPlace` drops the rest), so a provider candidate
 * always has a representative point. `PlaceGeometry`'s point branch requires
 * exactly this narrowing — declaring the full `LocationPrecision` here was a
 * type wider than the function, and the union is what surfaced it.
 */
export function precisionOf(
  place: ProviderPlace,
  placeType: GeoPlaceType,
): Exclude<LocationPrecision, 'area'> {
  if (placeType !== 'address') return 'centroid';
  const level = place.rawAddressType ?? place.rawType ?? '';
  return BUILDING_LEVEL_TYPES.has(level) || place.address.houseNumber ? 'exact' : 'centroid';
}

/**
 * Compose the secondary label from the STRUCTURED hierarchy, never by splitting
 * the provider's display string on commas.
 *
 * `display_name.split(',')` assumes a Western comma-separated ordering and
 * mangles every script and address format that does not use one (ADR §9.4). The
 * components are each provider-verbatim; only the joining is Homiio's, and the
 * full hierarchy travels separately in `admin` so a locale-aware UI can ignore
 * this string entirely and render the parts in its own order.
 *
 * The place's own name is skipped, so a city called Barcelona in a province
 * called Barcelona reads "Catalunya, España" rather than "Barcelona, Barcelona,
 * Catalunya, España".
 */
export function secondaryLabelOf(place: ProviderPlace, placeType: GeoPlaceType): string | undefined {
  const own = place.name;
  const parts: Array<string | undefined> = [];

  if (placeType === 'address') {
    parts.push(place.address.neighborhood, place.address.city, place.address.region);
  } else if (placeType === 'neighborhood' || placeType === 'district') {
    parts.push(place.address.city, place.address.region);
  } else if (placeType === 'city') {
    parts.push(place.address.region);
  } else if (placeType === 'postcode') {
    parts.push(place.address.city, place.address.region);
  }
  parts.push(place.address.country);

  const seen = new Set<string>();
  const composed = parts
    .filter((part): part is string => Boolean(part))
    .filter((part) => part !== own && !seen.has(part) && seen.add(part) !== undefined);

  return composed.length > 0 ? composed.join(', ') : undefined;
}

const boundsOf = (place: ProviderPlace): GeoBounds | undefined =>
  place.bounds
    ? {
        west: place.bounds.west,
        south: place.bounds.south,
        east: place.bounds.east,
        north: place.bounds.north,
      }
    : undefined;

/**
 * Build the public DTO, or return `null` when the provider did not supply
 * enough to build a valid one.
 *
 * The only way to fail is a missing `countryCode`, and it is a REFUSAL rather
 * than a default on purpose: `AdminHierarchy.countryCode` is non-optional, and
 * ADR §9.4 says there is no default country anywhere. The alternative —
 * inventing one — is how `cityService.getCityByLocation` ended up defaulting to
 * `'USA'`, which silently relocated every unresolved place to another
 * continent. Dropping the candidate is visible; a wrong country is not.
 */
export function toGeoPlace(place: ProviderPlace): GeoPlace | null {
  const countryCode = place.address.countryCode;
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) return null;

  const placeType = placeTypeOf(place);

  const label: PlaceLabel = {
    primary: place.name,
    kind: 'place',
  };
  const secondary = secondaryLabelOf(place, placeType);

  const admin: AdminHierarchy = {
    countryCode,
    ...(place.address.regionCode === undefined ? {} : { regionCode: place.address.regionCode }),
    ...(place.address.region === undefined ? {} : { regionName: place.address.region }),
    ...(place.address.city === undefined ? {} : { cityName: place.address.city }),
    ...(place.address.neighborhood === undefined
      ? {}
      : { neighborhoodName: place.address.neighborhood }),
  };

  const bounds = boundsOf(place);

  return {
    // An `external` place MUST carry its own centre and bounds inline, so a
    // provider disappearing degrades identity rather than usability (§9.2).
    source: { kind: 'external', provider: place.providerId, ref: place.ref },
    placeType,
    label: secondary === undefined ? label : { ...label, secondary },
    admin,
    center: { longitude: place.center.longitude, latitude: place.center.latitude },
    ...(bounds === undefined ? {} : { bounds }),
    precision: precisionOf(place, placeType),
  };
}

/**
 * The runtime type list and the compile-time union must agree.
 *
 * `validation.ts` cannot derive its membership test from `GeoPlaceType` — a
 * type has no runtime values — so the two are written out separately and
 * checked against each other here. The assignment below fails to compile if
 * `REQUESTABLE_PLACE_TYPES` ever names something `GeoPlaceType` does not, which
 * is the direction that would let a caller request a type no candidate can
 * carry and silently receive an empty list.
 */
const _requestableTypesAreGeoPlaceTypes: readonly GeoPlaceType[] = REQUESTABLE_PLACE_TYPES;
void _requestableTypesAreGeoPlaceTypes;
