/**
 * City response/filter types shared across Homiio frontend and backend.
 *
 * The canonical `City`, `Country`, `Region` and `Neighborhood` entity shapes
 * live in `./geo` (the DB-owned relational geo layer). This module owns the
 * city-scoped API request/response envelopes plus the neighborhood-insights
 * presentation type used by the area-insights UI.
 */

import { Coordinates, Pagination } from './common';
import type {
  AdminHierarchy,
  GeoBounds,
  GeoPoint,
  LocationPrecision,
  PlaceLabel,
  PlaceSource,
  PlaceType,
} from './location';
import type { ListingCurrency } from './currency';
import { City } from './geo';
import { Property } from './property';

export interface CityFilters {
  search?: string;
  /** Filter cities by country id (preferred) or ISO-2 country code. */
  countryId?: string;
  countryCode?: string;
  /** Filter cities by region id. */
  regionId?: string;
  limit?: number;
  page?: number;
}

export interface CityPropertiesResponse {
  city: City;
  properties: Property[];
  pagination: Pagination;
}

export interface CitiesResponse {
  data: City[];
  pagination: Pagination;
}

/**
 * A candidate returned by `GET /api/cities/lookup` (#295).
 *
 * Deliberately NOT the `City` entity above. `City` is the full record a city
 * page renders; this is the minimum a caller needs to TELL TWO CITIES APART and
 * then address one by id. Every field exists because a consumer named it: #352
 * frames a map from `center`/`bounds` and renders the disambiguation list from
 * `label` and `admin`.
 *
 * ## It is a `GeoPlace` in all but one field, and that field is the honest part
 *
 * `source`, `label`, `admin`, `center`, `bounds` and `precision` are the shared
 * primitives from `./location`, not copies of them, so a resolved candidate can
 * feed `geoPlaceToSelection` directly. The one difference: `GeoPlace.center` is
 * REQUIRED, because a geocoder candidate always has a point — while a Homiio
 * city row may have none. Production holds rows with null coordinates, and the
 * lookup ranks those below rows that have them rather than hiding them, so
 * `center` is optional here and `precision` says `area` when it is missing.
 * Inventing a centre to satisfy a type would be the one lie this whole contract
 * exists to stop.
 */
export interface CityPlaceCandidate {
  /**
   * The stable identity. Persist THIS, never the name or the slug.
   *
   * The same value as `source.id`, lifted to the top level because every
   * existing consumer of a city reads `.id`, and reaching it through the
   * `PlaceSource` union would cost a narrowing at each of them.
   */
  readonly id: string;
  /** `{ kind: 'homiio', entity: 'city', id }` — what `locationKey` keys on. */
  readonly source: PlaceSource;
  /** Always `city` here, typed from the shared union so a mixed list is possible. */
  readonly placeType: Extract<PlaceType, 'city'>;
  /**
   * Pre-split for display: `primary` is the canonical name verbatim (never
   * re-cased, never transliterated), `secondary` is "Region, Country".
   */
  readonly label: PlaceLabel;
  /** Explicit administrative hierarchy, so a UI can order it per locale. */
  readonly admin: AdminHierarchy;
  /** The owning country's Homiio id. `AdminHierarchy` carries codes, not ids. */
  readonly countryId: string;
  /** The owning region's Homiio id. */
  readonly regionId: string;
  /**
   * The URL-safe form of the name — `barcelona`. NOT unique: it is what an old
   * link carries, which is why it identifies nothing on its own.
   */
  readonly slug: string;
  /**
   * `slug`-`region`-`countryCode`, e.g. `barcelona-catalonia-es`. Far more
   * discriminating than the bare slug and still not guaranteed unique — two
   * names differing only in accents collapse onto one — which is why even this
   * form goes through the same four-outcome contract rather than being assumed
   * to resolve.
   */
  readonly qualifiedSlug: string;
  /** The city centre. A `centroid` (ADR §8.1), and so nobody's location. */
  readonly center?: GeoPoint;
  /**
   * The city's extent. `west > east` crosses the antimeridian (ADR §9.3).
   * Absent until #351's gateway populates it — never derived from listings.
   */
  readonly bounds?: GeoBounds;
  /** `centroid` with a centre, `area` without one. Declared, never inferred. */
  readonly precision: LocationPrecision;
  /** Published listings whose address resolves here. Ranking input, not identity. */
  readonly propertiesCount: number;
  /**
   * Which predicate matched this row. `id` is an identity match and resolves on
   * its own; `name` and `slug` are labels and can be shared.
   */
  readonly matchedOn: 'id' | 'name' | 'slug';
}

/**
 * The result of a text/slug/id city lookup.
 *
 * Four outcomes, three of them modelled here and the fourth (a validation
 * error) carried by HTTP 400 — see `controllers/cityController.lookupCity`
 * for the status-code mapping and why it is what it is.
 *
 * `ambiguous` is a SUCCESSFUL answer, not a failure: the server found several
 * equally valid places and is handing back the ordered list so a human can
 * choose. A consumer that needs exactly one city treats it as
 * `AMBIGUOUS_LOCATION` and asks; it must never take `candidates[0]`.
 */
export type CityLookupResult =
  | { status: 'resolved'; place: CityPlaceCandidate }
  | { status: 'ambiguous'; code: 'AMBIGUOUS_LOCATION'; candidates: CityPlaceCandidate[] }
  | { status: 'not_found' };

/**
 * Neighborhood-vs-city rent contrast. Present only when BOTH the neighborhood
 * and its city expose at least one comparable long-term listing average.
 */
export interface NeighborhoodVsCity {
  /** City-wide average long-term monthly rent (same basis as the neighborhood avg). */
  cityAverageRent: number;
  /** Integer percent difference of the neighborhood vs the city (negative = cheaper). */
  percentDiff: number;
}

/**
 * Neighborhood metrics DTO returned by `/api/neighborhoods/*`.
 *
 * Derived ENTIRELY from Homiio's own listings — there are no invented
 * walkability / transit / safety scores. When a metric has no real source it is
 * `null`/omitted rather than fabricated, and consumers hide the surface.
 */
export interface NeighborhoodMetrics {
  id: string;
  name: string;
  /** Owning city display name. */
  city: string;
  /** Owning city id (relational ref into the City collection). */
  cityId: string;
  /** Optional centroid for map framing. */
  centroid?: Coordinates;
  /** Count of published, available listings whose address resolves to this neighborhood. */
  listingCount: number;
  /**
   * Average long-term monthly rent (rounded) across those listings, or `null`
   * when none of them carry a positive monthly rent.
   */
  averageRent: number | null;
  /** Currency the `averageRent` is denominated in (the owning city's currency). */
  currency?: ListingCurrency;
  /** Neighborhood-vs-city rent contrast, or `null` when it can't be computed. */
  vsCity: NeighborhoodVsCity | null;
}
