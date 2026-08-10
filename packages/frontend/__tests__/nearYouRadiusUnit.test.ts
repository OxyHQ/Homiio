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
import { homeFeedQueryKeys } from '@/hooks/useHomeFeed';

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
    // Full precision belongs in the REQUEST, and §8.2 forbids the fix reaching
    // a key, a URL, a log or disk.
    //
    // This comment used to end "none of which is this call" — true of the
    // FUNCTION and false of where its output went: `useHomeFeed` embedded these
    // filters verbatim in a React Query key, and a query key is part of the
    // query cache that `getCategoryFilters`' own hardening promises never to
    // write to. A comment that is right about the line it sits on and wrong
    // about the data flow is worse than none, because it is what stops the next
    // person following the value. The key is fixed; see the describe below.
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

/**
 * The home feed's React Query key carries NO device coordinate.
 *
 * ADR 0002 §8.2's violation table names this file and these lines
 * (`useHomeFeed.ts:17-18`) as one of six places an exact position leaked. It
 * survived the first pass of that work because `usePropertySearch`'s key was
 * fixed and this one was not — two keys built by different rules, which is how
 * a rule stops holding without anybody deciding to stop holding it.
 *
 * Asserted on the SERIALISED key rather than field by field: a coordinate that
 * reappeared under another name, or nested one level deeper, slips past a
 * per-field check, and this key nests `filters` inside an object.
 */
describe('homeFeedQueryKeys.feed — no coordinate in the cache key', () => {
  const NEAR_YOU_FILTERS = {
    limit: 16,
    status: 'published' as const,
    lat: 41.3850639,
    lng: 2.1734035,
    radius: 25_000,
  };

  it('keys a near-you feed without the device fix', () => {
    const serialised = JSON.stringify(homeFeedQueryKeys.feed(NEAR_YOU_FILTERS, false));

    expect(serialised).not.toContain('41.3850639');
    expect(serialised).not.toContain('2.1734035');
    // The radius is not a coordinate and it distinguishes two real queries, so
    // it stays — through `locationKey`'s `here:<radius>` form.
    expect(serialised).toContain('here:25000');
  });

  it('gives two DIFFERENT positions at one radius the same key', () => {
    // The property that proves the coordinate is gone rather than merely
    // reformatted: if any part of the fix still varied with position, these
    // two would differ.
    const barcelona = homeFeedQueryKeys.feed(NEAR_YOU_FILTERS, false);
    const madrid = homeFeedQueryKeys.feed(
      { ...NEAR_YOU_FILTERS, lat: 40.4167754, lng: -3.7037902 },
      false,
    );

    expect(barcelona).toEqual(madrid);
  });

  it('still gives two RADII different keys, because they are different queries', () => {
    // The floor for the previous case. A key coarse enough to hide a position
    // must not be so coarse that a 5 km lens and a 25 km lens share a cache
    // entry — that would serve one the other's results.
    expect(homeFeedQueryKeys.feed(NEAR_YOU_FILTERS, false)).not.toEqual(
      homeFeedQueryKeys.feed({ ...NEAR_YOU_FILTERS, radius: 5_000 }, false),
    );
  });

  it('keeps the non-geographic filters in the key', () => {
    // Stripping the coordinates must not strip everything else with them: an
    // offering or a status change still has to re-key.
    const serialised = JSON.stringify(homeFeedQueryKeys.feed(NEAR_YOU_FILTERS, false));
    expect(serialised).toContain('published');
  });

  it('reports `none` for a feed with no coordinates at all', () => {
    const serialised = JSON.stringify(
      homeFeedQueryKeys.feed({ limit: 16, status: 'published' as const }, false),
    );
    expect(serialised).toContain('none');
  });
});
