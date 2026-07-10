/**
 * Neighborhood Service
 *
 * Thin client over the public `/api/neighborhoods/*` endpoints. Every value is
 * derived from Homiio's own listings on the backend — there are NO mocks and no
 * invented scores. Lookups that resolve no neighborhood (HTTP 404) map to
 * `null`, which callers render as "hidden", not as an error.
 */

import api, { ApiError } from '@/utils/api';
import type { NeighborhoodMetrics } from '@homiio/shared-types';

export type { NeighborhoodMetrics };

/** Envelope shape returned by the single-neighborhood endpoints. */
interface SingleEnvelope {
  success?: boolean;
  data?: NeighborhoodMetrics;
}

/** Envelope shape returned by the list endpoints. */
interface ListEnvelope {
  success?: boolean;
  data?: NeighborhoodMetrics[];
}

export interface NeighborhoodSearchFilters {
  /** City id or name to scope the search. */
  city?: string;
  /** Free-text neighborhood-name filter. */
  query?: string;
  limit?: number;
}

/** Map a "not found" (404) response to `null`; rethrow every other error. */
function nullIfNotFound(error: unknown): null {
  if (error instanceof ApiError && error.status === 404) return null;
  throw error;
}

class NeighborhoodService {
  /** Nearest neighborhood to a coordinate, or `null` when none is near enough. */
  async getByLocation(latitude: number, longitude: number): Promise<NeighborhoodMetrics | null> {
    try {
      const response = await api.get<SingleEnvelope>('/api/neighborhoods/by-location', {
        params: { latitude, longitude },
      });
      return response.data.data ?? null;
    } catch (error) {
      return nullIfNotFound(error);
    }
  }

  /** A neighborhood by name (optionally scoped to a city id/name), or `null`. */
  async getByName(name: string, city?: string): Promise<NeighborhoodMetrics | null> {
    try {
      const response = await api.get<SingleEnvelope>('/api/neighborhoods/by-name', {
        params: { name, city },
      });
      return response.data.data ?? null;
    } catch (error) {
      return nullIfNotFound(error);
    }
  }

  /** The neighborhood a property sits in, or `null` when it has none resolved. */
  async getByProperty(propertyId: string): Promise<NeighborhoodMetrics | null> {
    try {
      const response = await api.get<SingleEnvelope>(
        `/api/neighborhoods/by-property/${propertyId}`,
      );
      return response.data.data ?? null;
    } catch (error) {
      return nullIfNotFound(error);
    }
  }

  /** Neighborhoods matching the filters, each with derived metrics. */
  async search(filters: NeighborhoodSearchFilters = {}): Promise<NeighborhoodMetrics[]> {
    const response = await api.get<ListEnvelope>('/api/neighborhoods/search', {
      params: filters,
    });
    return response.data.data ?? [];
  }

  /** A city's neighborhoods ranked by real listing count. */
  async getPopular(city: string, limit = 10): Promise<NeighborhoodMetrics[]> {
    const response = await api.get<ListEnvelope>('/api/neighborhoods/popular', {
      params: { city, limit },
    });
    return response.data.data ?? [];
  }
}

export const neighborhoodService = new NeighborhoodService();
export default neighborhoodService;
