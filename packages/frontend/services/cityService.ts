/**
 * City Service
 * Handles API calls for city-related operations
 * Uses shared types from @homiio/shared-types
 *
 * ## A city is addressed by id; a name and a slug are labels (#295)
 *
 * `getCityBySlug` used to be the entry point for every deep link, and it guessed
 * three times over: it tried the token as an id, then looked it up in a
 * hardcoded fourteen-city map (`barcelona → Barcelona, Catalonia, Spain`), then
 * ran a name search and took `data[0]`. `getCityByLocation` defaulted the
 * country to `'USA'`. Between them, `?city=barcelona` resolved to whichever
 * Barcelona happened to sort first, a city outside the map resolved to whatever
 * a substring search ranked highest, and both answers could change as listings
 * arrived — with nothing anywhere saying a choice had been made.
 *
 * All of it is gone, replaced by {@link CityService.lookupCity}, which returns
 * the server's `CityLookupResult` union verbatim. A caller that needs one city
 * must handle `ambiguous` by ASKING; there is no longer an API here that will
 * pick for it.
 *
 * `searchCities` went with them. It was a typeahead wrapper whose only caller
 * was `getCityBySlug`'s `data[0]` fallback, so removing that left it dead — and
 * a "search, then take the first" affordance sitting in the file is how the
 * behaviour comes back. `GET /api/cities/search` is unchanged and remains the
 * right endpoint for a real typeahead; a screen that grows one should call it
 * and render the LIST.
 */

import api, { ApiError } from '@/utils/api';
import {
  City,
  CityFilters,
  CityLookupResult,
  CityPlaceCandidate,
  CityPropertiesResponse,
  CitiesResponse,
} from '@homiio/shared-types';

// Re-export the types for backward compatibility
export type { City, CityFilters, CityLookupResult, CityPlaceCandidate, CityPropertiesResponse, CitiesResponse };

/**
 * What a caller may hand the lookup besides the token.
 *
 * Every field is a DISCRIMINATOR the server applies as a filter, except `near`,
 * which biases the order of an ambiguous list and never removes a candidate.
 */
export interface CityLookupOptions {
  /** ISO-3166-1 alpha-2. There is no default country — see the module comment. */
  countryCode?: string;
  countryId?: string;
  regionId?: string;
  /** A region NAME, resolved within the country when one is given. */
  region?: string;
  /** Proximity bias, in degrees. Ranking only. */
  near?: { longitude: number; latitude: number };
  /** `west > east` crosses the antimeridian. */
  bounds?: { west: number; south: number; east: number; north: number };
  limit?: number;
}

class CityService {
  /**
   * Get all cities with optional filtering
   */
  async getCities(filters: CityFilters = {}): Promise<CitiesResponse> {
    const params = new URLSearchParams();

    // Geo is relational: cities filter by country/region IDS (or ISO-2 country
    // code), resolved server-side — there is no free-text state/country param.
    if (filters.search) params.append('search', filters.search);
    if (filters.countryId) params.append('countryId', filters.countryId);
    if (filters.countryCode) params.append('countryCode', filters.countryCode);
    if (filters.regionId) params.append('regionId', filters.regionId);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.page) params.append('page', filters.page.toString());

    const response = await api.get(`/api/cities?${params.toString()}`);
    return response.data;
  }

  /**
   * Get popular cities
   */
  async getPopularCities(limit: number = 10): Promise<{ data: City[] }> {
    const response = await api.get(`/api/cities/popular?limit=${limit}`);
    return response.data;
  }

  /**
   * Get city by ID
   */
  async getCityById(id: string): Promise<{ data: City }> {
    const response = await api.get(`/api/cities/${id}`);
    return response.data;
  }

  /**
   * Resolve a city token (an id, a name or a slug) to one place, a list of
   * candidates, or nothing.
   *
   * Never picks. `ambiguous` is a real outcome the caller must render — that is
   * the whole of #295 — and `not_found` is distinct from it: "we do not know
   * where that is" and "there are several of those" want different UI and a
   * different next step.
   *
   * The 404 is caught and mapped rather than thrown because `not_found` is a
   * member of the union, not an error condition. Any other failure (network, 5xx)
   * still throws, because "the request failed" and "there is no such city" are
   * different answers and a caller that cannot tell them apart will render the
   * wrong one (`docs/adr/0002` §4.3).
   */
  async lookupCity(token: string, options: CityLookupOptions = {}): Promise<CityLookupResult> {
    const params = new URLSearchParams({ q: token });
    if (options.countryCode) params.append('countryCode', options.countryCode);
    if (options.countryId) params.append('countryId', options.countryId);
    if (options.regionId) params.append('regionId', options.regionId);
    if (options.region) params.append('region', options.region);
    if (options.near) params.append('near', `${options.near.longitude},${options.near.latitude}`);
    if (options.bounds) {
      const { west, south, east, north } = options.bounds;
      params.append('bounds', `${west},${south},${east},${north}`);
    }
    if (options.limit) params.append('limit', String(options.limit));

    try {
      const response = await api.get(`/api/cities/lookup?${params.toString()}`);
      return response.data as CityLookupResult;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { status: 'not_found' };
      throw error;
    }
  }

  /**
   * Get properties by city
   */
  async getPropertiesByCity(
    cityId: string,
    options: {
      limit?: number;
      page?: number;
      sort?: string;
      verified?: boolean;
      eco?: boolean;
      minBedrooms?: number;
      maxPrice?: number;
      minPrice?: number;
    } = {},
  ): Promise<CityPropertiesResponse> {
    const params = new URLSearchParams();

    if (options.limit) params.append('limit', options.limit.toString());
    if (options.page) params.append('page', options.page.toString());
    if (options.sort) params.append('sort', options.sort);
    if (options.verified !== undefined) params.append('verified', options.verified.toString());
    if (options.eco !== undefined) params.append('eco', options.eco.toString());
    if (options.minBedrooms) params.append('minBedrooms', options.minBedrooms.toString());
    if (options.maxPrice) params.append('maxPrice', options.maxPrice.toString());
    if (options.minPrice) params.append('minPrice', options.minPrice.toString());

    const response = await api.get(`/api/cities/${cityId}/properties?${params.toString()}`);
    // The endpoint wraps the payload as `{ success, data: { city, properties,
    // pagination } }`; unwrap to the `CityPropertiesResponse` shape (tolerating a
    // flat body for safety).
    const body = response.data;
    return (body?.data ?? body) as CityPropertiesResponse;
  }

  /**
   * Create a new city (admin only)
   */
  async createCity(cityData: Partial<City>): Promise<{ data: City }> {
    const response = await api.post('/api/cities', cityData);
    return response.data;
  }

  /**
   * Update city properties count (admin only)
   */
  async updateCityPropertiesCount(cityId: string): Promise<{ data: City }> {
    const response = await api.put(`/api/cities/${cityId}/update-count`);
    return response.data;
  }

}

export const cityService = new CityService();
