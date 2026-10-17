/**
 * The address at a point, from Homiio's own reverse geocoder
 * (`/api/geocoding/reverse`, Nominatim-backed). Best-effort: `null` for no
 * address and for any failure, so a tap on the sea is not an error.
 */
import type { GeoCoordinate } from '@goway.to/maps';
import type { GeocodedAddress } from '@homiio/shared-types';

import { api, type ApiResponse } from '@/utils/api';

export async function lookupAddress(coordinate: GeoCoordinate): Promise<GeocodedAddress | null> {
  try {
    const { data: result } = await api.get<ApiResponse<GeocodedAddress>>('/api/geocoding/reverse', {
      params: { longitude: coordinate.longitude, latitude: coordinate.latitude },
      requireAuth: false,
    });
    return result.success && result.data ? result.data : null;
  } catch {
    return null;
  }
}
