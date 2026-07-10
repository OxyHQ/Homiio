/**
 * Geographic coordinate validation and repair for the geo write path.
 *
 * Listing parsers historically used EU price-style number coercion on lat/lng,
 * turning values like "43.541" into 43541. This module guards persistence.
 */

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

export function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= LAT_MIN && lat <= LAT_MAX;
}

export function isValidLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= LNG_MIN && lng <= LNG_MAX;
}

export function isValidCoordinatePair(lat: number, lng: number): boolean {
  return isValidLatitude(lat) && isValidLongitude(lng);
}

/** Attempt to recover coords mangled by thousands-separator parsing (e.g. 43541 → 43.541). */
export function tryRepairCoordinate(value: number, kind: 'lat' | 'lng'): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const max = kind === 'lat' ? LAT_MAX : LNG_MAX;
  const min = kind === 'lat' ? LAT_MIN : LNG_MIN;
  if (value >= min && value <= max) return value;

  const scaled = value / 1000;
  if (scaled >= min && scaled <= max) return scaled;

  return undefined;
}

export function sanitizeLatLngPair(
  lat: number,
  lng: number,
): { lat: number; lng: number } | undefined {
  let repairedLat = tryRepairCoordinate(lat, 'lat');
  let repairedLng = tryRepairCoordinate(lng, 'lng');

  if (repairedLat === undefined || repairedLng === undefined) {
    return undefined;
  }

  if (!isValidCoordinatePair(repairedLat, repairedLng)) {
    return undefined;
  }

  return { lat: repairedLat, lng: repairedLng };
}

/** GeoJSON order: [longitude, latitude]. */
export function sanitizeGeoJsonCoordinates(
  coordinates: [number, number] | undefined,
): [number, number] | undefined {
  if (!coordinates) return undefined;
  const [lng, lat] = coordinates;
  const pair = sanitizeLatLngPair(lat, lng);
  if (!pair) return undefined;
  return [pair.lng, pair.lat];
}
