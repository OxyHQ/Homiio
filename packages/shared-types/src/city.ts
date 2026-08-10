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
  PlaceGeometry,
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
 * ## Its geometry comes from `PlaceGeometry`, so the dishonest shape will not
 * compile
 *
 * `source`, `label`, `admin` and the geometry are the shared primitives from
 * `./location`, not copies of them, so a resolved candidate feeds
 * `geoPlaceToSelection` directly.
 *
 * A Homiio city row may have NO coordinates — production holds such rows, and
 * the lookup ranks them below rows that have them rather than hiding them. That
 * is expressed by `PlaceGeometry`'s `area` branch, where `center?: never`: a
 * candidate without a centre cannot acquire one, and a `centroid` without a
 * centre does not compile either. An earlier revision of this type said the same
 * thing with an optional `center` beside an open `precision`, which ACCEPTED the
 * contradiction and merely discouraged it.
 */
export type CityPlaceCandidate = {
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
  /** Published listings whose address resolves here. Ranking input, not identity. */
  readonly propertiesCount: number;
  /**
   * Which predicate matched this row. `id` is an identity match and resolves on
   * its own; `name` and `slug` are labels and can be shared.
   */
  readonly matchedOn: 'id' | 'name' | 'slug';
  /**
   * The centre (`centroid` — ADR §8.1, and so nobody's location) or the bare
   * extent, from {@link PlaceGeometry}. `bounds` is absent until #351's gateway
   * populates `cities.bbox_*`; `west > east` crosses the antimeridian (ADR §9.3).
   */
} & PlaceGeometry;

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
