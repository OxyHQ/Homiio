/**
 * City response/filter types shared across Homiio frontend and backend.
 *
 * The canonical `City`, `Country`, `Region` and `Neighborhood` entity shapes
 * live in `./geo` (the DB-owned relational geo layer). This module owns the
 * city-scoped API request/response envelopes plus the neighborhood-insights
 * presentation type used by the area-insights UI.
 */

import { Pagination } from './common';
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
 * Neighborhood scoring/insights presentation type (area-insights UI). Distinct
 * from the canonical `Neighborhood` entity in `./geo`: this carries derived
 * ratings/amenities for display, not the stored geo document.
 */
export interface NeighborhoodData {
  id: string;
  name: string;
  /** Owning city id (relational ref into the City collection). */
  cityId: string;
  overallScore: number;
  ratings: NeighborhoodRating[];
  description?: string;
  population?: number;
  averageRent?: number;
  crimeRate?: number;
  walkScore?: number;
  transitScore?: number;
  bikeScore?: number;
  amenities?: {
    restaurants: number;
    cafes: number;
    bars: number;
    groceryStores: number;
    parks: number;
    schools: number;
    hospitals: number;
    shoppingCenters: number;
  };
  images?: string[];
  lastUpdated: string;
}

export interface NeighborhoodRating {
  category: string;
  score: number;
  weight: number;
  description: string;
}
