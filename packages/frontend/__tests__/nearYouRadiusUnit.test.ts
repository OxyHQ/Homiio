/**
 * The "Near you" lens sends a radius in METRES.
 *
 * This is a unit test in the literal sense: the value is right or wrong by a
 * factor of 1000, and being wrong does not fail anywhere. `radius` is compared
 * against `ST_Distance` on `geography`, which is metres, so the old
 * `NEAR_YOU_RADIUS_KM = 25` asked for listings within 25 metres of the device —
 * false for every listing there has ever been — and the home feed answered with
 * a perfectly ordinary-looking page that simply was not near anyone. Nothing
 * threw, nothing was empty, and no test noticed, because the lens had none.
 *
 * The assertion is therefore on the EMITTED VALUE and not on the shape. A test
 * that only checked `radius` was present, or that it was a positive number,
 * would have passed against the bug it exists to catch — which is the whole
 * distinction this file turns on.
 */
import { getCategoryFilters } from '@/store/getCategoryFilters';

const DEVICE_FIX = { latitude: 41.3874, longitude: 2.1686 };

describe('getCategoryFilters — near_you', () => {
  it('emits the radius in metres, not kilometres', () => {
    const filters = getCategoryFilters('near_you', { userLocation: DEVICE_FIX });

    // 25 km expressed the way every consumer of this field reads it. `25` here
    // is the bug: it is the same number in the wrong unit, which is exactly why
    // it survived — it looks like a radius either way.
    expect(filters.radius).toBe(25_000);
    expect(filters.radius).not.toBe(25);
  });

  it('passes the device coordinates through unrounded, since they scope the request', () => {
    // Full precision belongs in the REQUEST. What ADR 0002 §8.2 forbids is the
    // fix reaching a key, a URL, a log or disk — none of which is this call.
    const filters = getCategoryFilters('near_you', { userLocation: DEVICE_FIX });

    expect(filters.lat).toBe(DEVICE_FIX.latitude);
    expect(filters.lng).toBe(DEVICE_FIX.longitude);
  });

  it('emits NO geographic filter when there is no device fix', () => {
    // The important half: without a position the lens must not fall back to an
    // unscoped feed that still calls itself "near you". Consumers gate on
    // `isNearYouBlocked`; this asserts the filters themselves carry nothing
    // geographic to be misread as a scope.
    const filters = getCategoryFilters('near_you', { userLocation: null });

    expect(filters).toEqual({});
    expect(filters).not.toHaveProperty('radius');
    expect(filters).not.toHaveProperty('lat');
    expect(filters).not.toHaveProperty('lng');
  });
});
