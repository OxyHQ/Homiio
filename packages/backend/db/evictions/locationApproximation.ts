/**
 * Turning a reported eviction location into one the board may publish.
 *
 * This module is the whole of ADR 0003 §7.1's "the approximation is generated
 * server-side, and is not a deterministic reusable offset". It is the only place
 * a true coordinate becomes a published one, and nothing downstream may
 * recompute or refine it.
 *
 * ## Why a ROUNDED coordinate was the wrong model
 *
 * The previous implementation rounded to three decimals (~110 m) on the way in.
 * That is real protection and it is still the wrong shape, for two reasons the
 * ADR states and this module fixes:
 *
 *  - **It is a grid.** Every rounded point sits on a lattice of known spacing,
 *    so the true point is one of a small, enumerable set of cells and the offset
 *    is recoverable in the sense that matters — you know exactly which 110 m
 *    square the home is in.
 *  - **It looks exact.** A consumer receiving `2.174, 41.385` has no way to know
 *    it is wrong by up to 110 m, so every map draws a pin on a building. The
 *    board publishes a CENTRE AND A RADIUS instead, and a map that receives both
 *    can draw the uncertainty it actually has.
 *
 * ## What replaces it
 *
 * A point drawn UNIFORMLY AT RANDOM from the disc of the published radius around
 * the true point, using `node:crypto`. Two properties follow, and both are
 * tested:
 *
 *  1. **Two cases at the same true coordinate publish different centres.** There
 *     is no per-deployment constant, no key, no hash of the case id — nothing an
 *     attacker with a thousand fixtures can solve for.
 *  2. **The true point is uniformly distributed inside the published disc.** So
 *     the published centre plus the published radius is a complete and honest
 *     description of what Homiio is willing to say, rather than a point that is
 *     secretly better than it claims.
 *
 * ### The residual, stated rather than hidden
 *
 * Averaging many independent draws around ONE true point converges on it. That
 * is why {@link shouldRedrawPublicLocation} exists: a case's published centre is
 * drawn once and is NOT redrawn while a resubmitted true point still lies inside
 * the disc already published. An organiser can still force redraws by moving a
 * case out of its disc and back, and each move writes a visible timeline event —
 * so the leak requires the case's own organiser, who knows the true point
 * already, to act conspicuously. Recorded because a privacy claim with no stated
 * residual is a claim nobody can check.
 *
 * ## The radius is not a constant
 *
 * A 300 m disc in central Barcelona contains several hundred homes; the same
 * disc in a village contains three. The published radius is therefore widened by
 * the DENSITY of Homiio's own address data around the true point — #358's "la
 * precisión puede reducirse más en zonas rurales o con pocos hogares" — and the
 * measurement is real Homiio data, never an estimate.
 */

import { sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import {
  EVICTION_MAX_PUBLIC_RADIUS_METERS,
  EVICTION_MIN_PUBLIC_RADIUS_METERS,
} from '../schema/evictions';
import { getDb, type DatabaseOrTransaction } from '../postgres';

/**
 * The grain of {@link cryptoUnitFloat}, in draws.
 *
 * `crypto.randomInt(max)` takes an EXCLUSIVE max and refuses anything above
 * 2^48 - 1, so this is that ceiling rather than 2^48 — measured, as a
 * `RangeError: The value of "max" is out of range` on the first run with the
 * round number. Every value below it is exactly representable in a double, so
 * the quotient is uniform in `[0, 1)` with no rounding residue. It is far finer
 * than the metre-scale offset it feeds, so the grain is invisible in the output
 * and the bound is a property of the primitive rather than of this feature.
 */
const UNIT_FLOAT_RESOLUTION = 2 ** 48 - 1;

/** Metres per degree of latitude. Constant enough at every latitude to use. */
const METERS_PER_DEGREE_LATITUDE = 111_320;

/**
 * How far around the true point density is measured.
 *
 * Wider than the narrowest published radius on purpose: measuring density
 * inside the disc you are about to publish makes the sample vary with the
 * answer, and a 1 km neighbourhood is the scale at which "is this urban" is a
 * meaningful question.
 */
const DENSITY_SAMPLE_RADIUS_METERS = 1_000;

/**
 * Address count within {@link DENSITY_SAMPLE_RADIUS_METERS} → published radius.
 *
 * Ordered densest first, and read with the first matching entry. The buckets are
 * coarse deliberately: a finer ladder would publish a more precise statement
 * about how many homes surround the case, which is information about the place
 * nobody asked us to disclose.
 */
const RADIUS_BY_DENSITY: readonly { readonly minAddresses: number; readonly radiusMeters: number }[] =
  [
    { minAddresses: 200, radiusMeters: EVICTION_MIN_PUBLIC_RADIUS_METERS },
    { minAddresses: 50, radiusMeters: 750 },
    { minAddresses: 10, radiusMeters: 1_500 },
    { minAddresses: 0, radiusMeters: EVICTION_MAX_PUBLIC_RADIUS_METERS },
  ];

/** A published location: a centre nobody lives at, and how far off it may be. */
export interface PublicDisc {
  readonly longitude: number;
  readonly latitude: number;
  readonly radiusMeters: number;
}

/** A point somebody reported. Never published, and usually never stored. */
export interface TruePoint {
  readonly longitude: number;
  readonly latitude: number;
}

/**
 * A uniform float in `[0, 1)` from the system CSPRNG.
 *
 * `Math.random` is seeded per process and is not required to be unpredictable —
 * which is exactly the property this offset depends on.
 *
 * `randomInt` rather than assembling bytes by hand. Both are unbiased here (48
 * bits is exact in a double's 53-bit mantissa, so there is no modulo residue),
 * but `randomInt` is the primitive that says so: it rejection-
 * samples internally, and it is what a reader — and CodeQL's
 * `js/biased-cryptographic-random` — recognises as unbiased without having to
 * re-derive the arithmetic. Hand-rolled entropy assembly next to a security
 * claim is a place where being right is not the same as being checkable.
 */
function cryptoUnitFloat(): number {
  return randomInt(UNIT_FLOAT_RESOLUTION) / UNIT_FLOAT_RESOLUTION;
}

/**
 * Wrap a longitude into `[-180, 180)`.
 *
 * An offset near the antimeridian genuinely crosses it, and a longitude of 180.4
 * is refused by `eviction_cases_coordinates_range_check` — so the wrap is a
 * correctness requirement rather than tidiness.
 */
function wrapLongitude(value: number): number {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped;
}

/**
 * Draw a point uniformly from the disc of `radiusMeters` around `point`.
 *
 * `r = R·√u` rather than `r = R·u`: the naive form concentrates draws near the
 * centre, which would make the published point a better estimate of the true one
 * the closer you get — the opposite of what this function is for.
 *
 * Exported so the property tests can drive it directly with a known centre; it
 * has no other caller outside {@link derivePublicDisc}.
 */
export function offsetWithinDisc(point: TruePoint, radiusMeters: number): TruePoint {
  const distance = radiusMeters * Math.sqrt(cryptoUnitFloat());
  const bearing = 2 * Math.PI * cryptoUnitFloat();

  const deltaLatitude = (distance * Math.cos(bearing)) / METERS_PER_DEGREE_LATITUDE;
  // A degree of longitude shrinks with latitude, and at the poles it collapses.
  // Clamping the cosine keeps the division finite; a case within ~0.06° of a
  // pole is not a case this product has, and a division by zero there would
  // produce `Infinity` and a CHECK violation rather than a wrong answer.
  const latitudeRadians = (point.latitude * Math.PI) / 180;
  const longitudeScale = Math.max(Math.cos(latitudeRadians), 0.001);
  const deltaLongitude =
    (distance * Math.sin(bearing)) / (METERS_PER_DEGREE_LATITUDE * longitudeScale);

  return {
    longitude: wrapLongitude(point.longitude + deltaLongitude),
    // Latitude does not wrap: past a pole is meaningless, so it clamps.
    latitude: Math.min(90, Math.max(-90, point.latitude + deltaLatitude)),
  };
}

/**
 * Great-circle distance in metres between two points.
 *
 * Haversine rather than a PostGIS round trip: the one caller is
 * {@link shouldRedrawPublicLocation}, which runs inside a request that has
 * already decided whether it is touching the database, and asking Postgres to
 * compare two numbers the process is holding would be a query for a fact it
 * already has.
 */
export function distanceMeters(a: TruePoint, b: TruePoint): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6_371_008.8;
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How many Homiio addresses sit within {@link DENSITY_SAMPLE_RADIUS_METERS}.
 *
 * `ST_DWithin` on the GENERATED `addresses.geo` column, so the GiST index
 * answers it. Failures are NOT swallowed: a database error here is the same
 * database error the insert two statements later would hit, and reporting an
 * outage as "this is a sparse area" would silently publish the WIDEST disc while
 * looking like a measurement. Same call, for the same reason, as
 * `resolveAgencyId`.
 */
async function countNearbyAddresses(
  point: TruePoint,
  db: DatabaseOrTransaction,
): Promise<number> {
  const rows = await db.execute<{ nearby: string | number }>(sql`
    select count(*)::int as nearby
    from addresses
    where addresses.geo is not null
      and ST_DWithin(
        addresses.geo,
        ST_MakePoint(${point.longitude}, ${point.latitude})::geography,
        ${DENSITY_SAMPLE_RADIUS_METERS}
      )
  `);
  // `count(*)` is `bigint`, which postgres.js decodes as a STRING — the cast to
  // `::int` above makes it a number, and `Number(...)` makes that true whichever
  // path the driver took. Getting this wrong is not a type error: `count + 1`
  // would be string concatenation that type-checks clean.
  return Number(rows[0]?.nearby ?? 0);
}

/** The published radius for a point, from Homiio's own address density. */
export async function resolvePublicRadiusMeters(
  point: TruePoint,
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const nearby = await countNearbyAddresses(point, db);
  const bucket = RADIUS_BY_DENSITY.find((entry) => nearby >= entry.minAddresses);
  // The list ends at `minAddresses: 0`, so `find` always matches; the fallback
  // is the widest radius rather than the narrowest, because a bucket table that
  // somehow failed to match must not answer with the most revealing option.
  return bucket?.radiusMeters ?? EVICTION_MAX_PUBLIC_RADIUS_METERS;
}

/**
 * The disc a case publishes, from the point its organiser reported.
 *
 * The true point is used here and then dropped by the caller: unless the
 * affected household authorised exact disclosure, it is never written to any
 * column (ADR 0003 §3.3 names this table as the example of that rule).
 */
export async function derivePublicDisc(
  point: TruePoint,
  db: DatabaseOrTransaction = getDb(),
): Promise<PublicDisc> {
  const radiusMeters = await resolvePublicRadiusMeters(point, db);
  const offset = offsetWithinDisc(point, radiusMeters);
  return { longitude: offset.longitude, latitude: offset.latitude, radiusMeters };
}

/**
 * Whether a resubmitted true point needs a NEW published disc.
 *
 * `false` when the new point still lies inside the disc already published, which
 * is the common case of an organiser re-saving a case without moving it. That
 * matters for privacy rather than for efficiency: every redraw is an independent
 * sample around the true point, and a public observer collecting several of them
 * can average towards it. Refusing to move is also the honest answer — the
 * existing disc still contains the point, so it is still a true statement.
 */
export function shouldRedrawPublicLocation(
  published: PublicDisc,
  point: TruePoint,
): boolean {
  return (
    distanceMeters({ longitude: published.longitude, latitude: published.latitude }, point) >
    published.radiusMeters
  );
}
