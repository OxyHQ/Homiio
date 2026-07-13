/**
 * City response/filter types shared across Homiio frontend and backend.
 *
 * The canonical `City`, `Country`, `Region` and `Neighborhood` entity shapes
 * live in `./geo` (the DB-owned relational geo layer). This module owns the
 * city-scoped API request/response envelopes plus the neighborhood-insights
 * presentation type used by the area-insights UI.
 */

import { Coordinates, Pagination } from './common';
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
