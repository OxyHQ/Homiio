/**
 * The geo gateway derives a WRAP-AWARE centre — asserted on the backend, through
 * the gateway, rather than on the helper.
 *
 * ## Why this file exists
 *
 * `boundsCenter` (`@homiio/shared-types`) walks east from `west` by half the
 * eastward span, so a box crossing the antimeridian is measured the short way
 * round. Reverting it to the naive `(west + east) / 2` — the arithmetic that
 * puts a box spanning 170°E to 170°W at longitude 0, in the Gulf of Guinea
 * rather than the Pacific — turned **exactly one** test red across the whole
 * repository, and that test is in the FRONTEND
 * (`packages/frontend/__tests__/resolveLocationRef.test.ts`).
 *
 * The backend suite passed the same mutation completely: 140 suites, 1912 tests,
 * zero red. So `services/geocoding/gateway.ts`'s `centerOfBounds` — the geo
 * gateway's centre derivation, which every place lookup funnels through — had no
 * wrap coverage at all. The single guard was standing next to a door it did not
 * watch, and a backend-side regression or reimplementation was invisible.
 *
 * Measured 2026-08-10 during the post-merge gate pass at `6c21632b`.
 *
 * ## Why it goes through the GATEWAY and not the helper
 *
 * A test that called `boundsCenter` directly would still pass if
 * `centerOfBounds` stopped delegating to the shared helper and grew its own
 * arithmetic again — which is the reimplementation this is defending against,
 * and the more likely regression of the two, because the file's own history is
 * a local implementation carrying a comment that said it was "not valid across
 * the antimeridian". A documented wrong answer survives review; that is why it
 * lasted. So the assertion is made on what `resolvePlace` returns.
 *
 * `packages/frontend/__tests__/…` (#402) pins the same helper for the frontend
 * call sites. Both exist because the two halves fail independently: the frontend
 * test cannot see a backend reimplementation, and this one cannot see a frontend
 * one. One helper, two consumers, two guards.
 */
import { eq } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { neighborhoods } from '../../db/schema';
import { resolvePlace } from '../../services/geocoding/gateway';
import { resetGeoCache } from '../../services/geocoding/cache';
import { resetGeoTables, seedGeoChain, seedNeighborhood } from '../helpers/postgresGeoFixtures';

/**
 * A neighbourhood with a bounding box and NO stored centroid.
 *
 * **DO NOT give this fixture a centroid.** `resolveHomiioPlace` prefers a stored
 * `longitude`/`latitude` and only falls back to deriving one from the envelope,
 * so a centroid makes the derivation unreachable and BOTH tests below vacuous —
 * they would pass with `centerOfBounds` deleted outright.
 *
 * The trap is that the tidy fixture is the one with a centroid: a real
 * neighbourhood row usually has both, so "completing" this fixture to look like
 * production data is the change that silently removes the only thing it tests.
 * If a future assertion needs a stored centroid, it needs its own fixture rather
 * than this one.
 */
async function seedBoxedNeighborhood(bounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}): Promise<string> {
  const chain = await seedGeoChain({ cityName: 'Wraptown' });
  const id = await seedNeighborhood({ cityId: chain.cityId, name: 'Boxed' });
  await getDb()
    .update(neighborhoods)
    .set({
      latitude: null,
      longitude: null,
      bboxWest: bounds.west,
      bboxSouth: bounds.south,
      bboxEast: bounds.east,
      bboxNorth: bounds.north,
    })
    .where(eq(neighborhoods.id, id));
  return id;
}

describe('the geo gateway derives a wrap-aware centre', () => {
  beforeEach(async () => {
    await resetGeoTables();
    resetGeoCache();
  });

  afterAll(async () => {
    await resetGeoTables();
    resetGeoCache();
  });

  it('puts a box crossing the antimeridian at ±180, not at 0', async () => {
    // 170°E → 170°W. The short way round is 20° wide and centred on the date
    // line; the naive midpoint is 0, which is half a world away in the Atlantic.
    const id = await seedBoxedNeighborhood({ west: 170, south: -10, east: -170, north: 10 });

    const { place } = await resolvePlace(`neighborhood.homiio.${id}`, 'en');

    expect(place?.center).toBeDefined();
    const longitude = place?.center?.longitude ?? 0;

    // ±180 are the same meridian, and `normalizeLongitude` may return either.
    expect(Math.abs(longitude)).toBeCloseTo(180, 6);

    // Stated separately and deliberately: this is the value the naive
    // arithmetic produces, and asserting its ABSENCE is what makes the case
    // fail for the right reason rather than merely passing.
    expect(longitude).not.toBeCloseTo(0, 6);

    // Latitude never wraps — `south > north` is an error, not a convention — so
    // the plain midpoint is correct here and a "fix" must not disturb it.
    expect(place?.center?.latitude).toBeCloseTo(0, 6);
  });

  it('leaves an ordinary box at its plain midpoint', async () => {
    // DO NOT delete this as redundant. The naive and wrap-aware forms agree
    // here, so it deliberately distinguishes NOTHING — it is the guard against a
    // "fix" that special-cases the antimeridian and breaks every ordinary box,
    // which is the shape a hurried repair of the case above would take.
    // Barcelona's envelope, the same fixture the shared helper's own tests use.
    const id = await seedBoxedNeighborhood({ west: 2.05, south: 41.32, east: 2.23, north: 41.47 });

    const { place } = await resolvePlace(`neighborhood.homiio.${id}`, 'en');

    expect(place?.center?.longitude).toBeCloseTo(2.14, 6);
    expect(place?.center?.latitude).toBeCloseTo(41.395, 6);
  });
});
