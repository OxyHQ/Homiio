/**
 * A device-scoped search asks for a radius in METRES, and its cache key carries
 * no coordinate.
 *
 * ## Why this file changed hands (it was `nearYouRadiusUnit.test.ts`)
 *
 * It guarded the `near_you` home CATEGORY: `getCategoryFilters('near_you')` and
 * `homeFeedQueryKeys.feed`. #353 deleted both — Home is local by construction
 * now, resolved by `useLocationScope` before anything is fetched, so a "near
 * you" chip the user had to select is gone along with the eighteen-category
 * strip it lived in. The two PROPERTIES it pinned are unchanged and still worth
 * exactly as much, so they moved onto the code that replaced it rather than
 * being deleted with their subject.
 *
 * **Property 1 — the unit.** The value is right or wrong by a factor of 1000 and
 * being wrong does not fail anywhere. `radius` is compared against `ST_DWithin`
 * on `geography`, which is metres, so the original `NEAR_YOU_RADIUS_KM = 25`
 * asked for listings within 25 METRES of the device — false for every listing
 * there has ever been — and the feed answered with a perfectly ordinary-looking
 * page that simply was not near anyone. Nothing threw, nothing was empty, and no
 * test noticed, because the lens had none.
 *
 * The assertion is therefore on the EMITTED VALUE, never on the shape. A test
 * that checked `radius` was present, or positive, would have passed against the
 * bug it exists to catch — which is the whole distinction this file turns on.
 *
 * **Property 2 — no coordinate in a cache key.** ADR 0002 §8.2's violation table
 * named `useHomeFeed.ts:17-18` as one of six places an exact position leaked.
 * Asserted on the SERIALISED key rather than field by field: a coordinate that
 * reappeared under another name, or nested one level deeper, slips past a
 * per-field check.
 */
import { DEVICE_SCOPE_RADIUS_METERS } from '@/hooks/useLocationScope';
import { homeSectionsQueryKey } from '@/hooks/useHomeSections';
import { OfferingType, type LocationSelection } from '@homiio/shared-types';

/** Two real positions, far enough apart that any leak is unmistakable. */
const BARCELONA = { longitude: 2.1734035, latitude: 41.3850639 };
const MADRID = { longitude: -3.7037902, latitude: 40.4167754 };

function deviceScope(
  center: { longitude: number; latitude: number },
  radiusMeters: number = DEVICE_SCOPE_RADIUS_METERS,
): LocationSelection {
  return { kind: 'current_location', center, radiusMeters, precision: 'exact' };
}

describe('the device scope radius', () => {
  it('is expressed in metres, not kilometres', () => {
    // 25 km, the way every consumer of this field reads it. `25` is the bug: the
    // same number in the wrong unit, which is exactly why it survived — it looks
    // like a radius either way.
    expect(DEVICE_SCOPE_RADIUS_METERS).toBe(25_000);
    expect(DEVICE_SCOPE_RADIUS_METERS).not.toBe(25);
  });
});

describe('homeSectionsQueryKey — no coordinate in the cache key', () => {
  it('keys a device scope without the device fix', () => {
    const serialised = JSON.stringify(
      homeSectionsQueryKey(deviceScope(BARCELONA), OfferingType.LONG_TERM_RENT),
    );

    expect(serialised).not.toContain('41.3850639');
    expect(serialised).not.toContain('2.1734035');
    // The radius is not a coordinate and it distinguishes two real queries, so
    // it stays — through `locationKey`'s `here:<radius>` form.
    expect(serialised).toContain('here:25000');
  });

  it('gives two DIFFERENT positions at one radius the same key', () => {
    // The property that proves the coordinate is gone rather than merely
    // reformatted: if any part of the fix still varied with position, these two
    // would differ.
    expect(homeSectionsQueryKey(deviceScope(BARCELONA), OfferingType.LONG_TERM_RENT)).toEqual(
      homeSectionsQueryKey(deviceScope(MADRID), OfferingType.LONG_TERM_RENT),
    );
  });

  it('still gives two RADII different keys, because they are different queries', () => {
    // The floor for the previous case. A key coarse enough to hide a position
    // must not be so coarse that a 5 km lens and a 25 km lens share a cache
    // entry — that would serve one the other's results.
    expect(homeSectionsQueryKey(deviceScope(BARCELONA), OfferingType.LONG_TERM_RENT)).not.toEqual(
      homeSectionsQueryKey(deviceScope(BARCELONA, 5_000), OfferingType.LONG_TERM_RENT),
    );
  });

  it('keeps the offering in the key', () => {
    // Stripping the coordinates must not strip everything else with them: an
    // offering change still has to re-key, or a "for sale" surface would be
    // served the long-term cache entry.
    expect(homeSectionsQueryKey(deviceScope(BARCELONA), OfferingType.LONG_TERM_RENT)).not.toEqual(
      homeSectionsQueryKey(deviceScope(BARCELONA), OfferingType.SALE),
    );
  });

  it('reports `none` for a scope with no location at all', () => {
    const serialised = JSON.stringify(homeSectionsQueryKey(null, OfferingType.LONG_TERM_RENT));
    expect(serialised).toContain('none');
  });
});
