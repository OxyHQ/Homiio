/**
 * City Service
 * Handles API calls for city-related operations
 * Uses shared types from @homiio/shared-types
 */

import api from '@/utils/api';
import {
  City,
  CityFilters,
  CityPropertiesResponse,
  CitiesResponse,
  Property,
} from '@homiio/shared-types';

// Re-export the types for backward compatibility
export type { City, CityFilters, CityPropertiesResponse, CitiesResponse };

class CityService {
  /**
   * Get all cities with optional filtering
   */
  async getCities(filters: CityFilters = {}): Promise<CitiesResponse> {
    const params = new URLSearchParams();

    if (filters.search) params.append('search', filters.search);
    if (filters.state) params.append('state', filters.state);
    if (filters.country) params.append('country', filters.country);
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
   * Get city by name, state, and country
   */
  async getCityByLocation(
    name: string,
    state: string,
    country: string = 'USA',
  ): Promise<{ data: City }> {
    const params = new URLSearchParams({
      name,
      state,
      country,
    });

    const response = await api.get(`/api/cities/lookup?${params.toString()}`);
    return response.data;
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
    return response.data;
  }

  /**
   * Search cities by query
   */
  async searchCities(query: string, limit: number = 10): Promise<{ data: City[] }> {
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
    });

    const response = await api.get(`/api/cities/search?${params.toString()}`);
    return response.data;
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

  /**
   * Get city by slug (converts slug to city lookup)
   */
  async getCityBySlug(slug: string): Promise<{ data: City } | null> {
    try {
      // Try to find city by ID first
      return await this.getCityById(slug);
    } catch (error) {
      // If not found by ID, try to parse as city name
      const cityName = slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

      // Common city mappings for slugs
      const cityMappings: { [key: string]: { name: string; state: string; country: string } } = {
        'new-york': { name: 'New York', state: 'New York', country: 'USA' },
        'los-angeles': { name: 'Los Angeles', state: 'California', country: 'USA' },
        chicago: { name: 'Chicago', state: 'Illinois', country: 'USA' },
        miami: { name: 'Miami', state: 'Florida', country: 'USA' },
        austin: { name: 'Austin', state: 'Texas', country: 'USA' },
        seattle: { name: 'Seattle', state: 'Washington', country: 'USA' },
        denver: { name: 'Denver', state: 'Colorado', country: 'USA' },
        nashville: { name: 'Nashville', state: 'Tennessee', country: 'USA' },
        portland: { name: 'Portland', state: 'Oregon', country: 'USA' },
        'san-francisco': { name: 'San Francisco', state: 'California', country: 'USA' },
        barcelona: { name: 'Barcelona', state: 'Catalonia', country: 'Spain' },
        berlin: { name: 'Berlin', state: 'Berlin', country: 'Germany' },
        amsterdam: { name: 'Amsterdam', state: 'North Holland', country: 'Netherlands' },
        stockholm: { name: 'Stockholm', state: 'Stockholm', country: 'Sweden' },
      };

      const mapping = cityMappings[slug.toLowerCase()];
      if (mapping) {
        return await this.getCityByLocation(mapping.name, mapping.state, mapping.country);
      }

      // If no mapping found, try a search
      const searchResults = await this.searchCities(cityName, 1);
      if (searchResults.data.length > 0) {
        return { data: searchResults.data[0] };
      }

      return null;
    }
  }
}

export const cityService = new CityService();
