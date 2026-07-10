import {
  isValidCoordinatePair,
  sanitizeGeoJsonCoordinates,
  sanitizeLatLngPair,
  tryRepairCoordinate,
} from '../../utils/geoCoordinates';

describe('geoCoordinates', () => {
  it('keeps valid lat/lng unchanged', () => {
    expect(sanitizeLatLngPair(43.541, -7.294)).toEqual({ lat: 43.541, lng: -7.294 });
    expect(isValidCoordinatePair(43.541, -7.294)).toBe(true);
  });

  it('repairs thousands-mangled Barreiros-style latitude', () => {
    expect(tryRepairCoordinate(43541, 'lat')).toBe(43.541);
    expect(sanitizeLatLngPair(43541, -7.294)).toEqual({ lat: 43.541, lng: -7.294 });
  });

  it('rejects irreparable values', () => {
    expect(tryRepairCoordinate(999999, 'lat')).toBeUndefined();
    expect(sanitizeLatLngPair(999999, -7.294)).toBeUndefined();
  });

  it('sanitizes GeoJSON [lng, lat] order', () => {
    expect(sanitizeGeoJsonCoordinates([-7.294, 43541])).toEqual([-7.294, 43.541]);
    expect(sanitizeGeoJsonCoordinates(undefined)).toBeUndefined();
  });
});
