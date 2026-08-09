/**
 * `place_pois` and `place_poi_categories` — the persisted nearby-services cache.
 *
 * Ported from `models/schemas/PlacePoiSchema.ts`. Empty in production.
 *
 * For a coordinate CELL at a given radius, it stores the aggregate per-category
 * result sourced from OpenStreetMap's Overpass API. Deliberately aggregate-only:
 * it never stores an individual place NAME, which is a contract with the API
 * rather than an implementation detail, and the schema is what keeps it true —
 * there is nowhere to put one.
 *
 * ## This table carries a TTL, and it is a genuine one
 *
 * `{ expiresAt: 1 }, { expireAfterSeconds: 0 }`. Unlike
 * `conversations.sharing_expires_at`, which destroys a user's transcript, this
 * one deletes a cached copy of somebody else's public data and the service
 * re-fetches it on the next miss. It is registered in `db/expiry.ts`, and it has
 * to be: Mongo reaped these rows and Postgres will not.
 *
 * ## `categories[]` becomes a table, not twelve triples of columns and not jsonb
 *
 * The array holds one entry per category, with every key always present — so
 * flattening it would be 36 columns whose names encode a vocabulary, and every
 * new category would be a migration on the cache. `jsonb` is wrong for the
 * opposite reason: the shape is CLOSED and known, which is the test
 * `CONVENTIONS.md` sets for when `jsonb` is NOT the answer.
 *
 * The child table also buys a constraint the Mongo array could not express —
 * `UNIQUE(place_poi_id, key)`, i.e. one summary per category per cell. A
 * duplicated key made `present` and `count` depend on which element a reader
 * happened to take first.
 */

import { bigint, boolean, check, doublePrecision, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxyhq/db';

/** Mirrors `NearbyServiceKey` in shared-types. */
export const NEARBY_SERVICE_KEYS = [
  'pharmacy',
  'school',
  'hospital',
  'police',
  'fire_station',
  'supermarket',
  'transit',
  'park',
  'bank',
  'restaurant',
  'gym',
  'spa',
] as const;

export const placePois = pgTable(
  'place_pois',
  {
    id: generatedId(),

    /**
     * The canonical cache key, `"{lat},{lng}@{radiusM}"` with the coordinates
     * rounded to the service's cell precision.
     *
     * Kept as a stored column rather than derived from the three columns beside
     * it: the rounding and the formatting both live in
     * `nearbyServicesService`, so a generated column would have to reproduce
     * them exactly — and if it ever drifted, a cache would start missing every
     * row it already held, silently, at the cost of an Overpass call per read.
     */
    cellKey: text().notNull(),
    /** The rounded cell-anchor coordinates, i.e. the values embedded in `cell_key`. */
    lat: doublePrecision().notNull(),
    lng: doublePrecision().notNull(),
    /**
     * Search radius in metres.
     *
     * `bigint`: the service passes whole metres from its own constant, never a
     * portal-supplied number.
     *
     * NOTE there is deliberately NO `geography` column here, unlike `addresses`
     * and `eviction_cases`. Nothing queries this table spatially — a lookup is an
     * equality on `cell_key`, which is the whole point of rounding to a cell.
     * Adding a point because the columns look like the ones on `addresses` is
     * the speculative index `CONVENTIONS.md` forbids, and it is the same call
     * `cities` and `neighborhoods` already got.
     */
    radiusM: bigint({ mode: 'number' }).notNull(),

    /** When this snapshot was fetched from Overpass. */
    fetchedAt: timestamptz().notNull(),
    /** The deadline. Registered in `db/expiry.ts`; see the header. */
    expiresAt: timestamptz().notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('place_pois_cell_key_key').on(table.cellKey),
    /**
     * The expiry sweep's range scan, and it is REQUIRED rather than nice to
     * have: `findUnsupportedExpiryColumns` fails the build for a registered
     * column with no leading btree, because without one the sweep is a full scan
     * on a schedule. Mongo's TTL index carried the same obligation implicitly.
     */
    index('place_pois_expires_at_idx').on(table.expiresAt),
    /** `min: 1` from the schema — a zero-metre radius is a cache key for nothing. */
    check('place_pois_radius_check', sql`${table.radiusM} >= 1`),
    /**
     * The coordinate bounds. Mongo declared `min`/`max` on both, and unlike most
     * range validators in this migration these are not deferred: the columns are
     * half of a cache KEY, so a wrapped coordinate does not fail, it silently
     * serves one place's amenities for another's.
     */
    check(
      'place_pois_coordinates_range_check',
      sql`${table.lat} between -90 and 90 and ${table.lng} between -180 and 180`,
    ),
  ],
);

export const placePoiCategories = pgTable(
  'place_poi_categories',
  {
    id: generatedId(),
    /**
     * CASCADE, and here it is load-bearing rather than tidy: the parent is under
     * an active expiry sweep, so RESTRICT would abort the sweep on its first
     * batch and the cache would grow forever — which is the failure this whole
     * registry exists to prevent.
     */
    placePoiId: text()
      .notNull()
      .references(() => placePois.id, { onDelete: 'cascade' }),
    key: text({ enum: NEARBY_SERVICE_KEYS }).notNull(),
    /** Whether at least one place of this category is inside the radius. */
    present: boolean().notNull().default(false),
    /** How many. `bigint` — a count this package computes. */
    count: bigint({ mode: 'number' }).notNull().default(0),
    /** Straight-line metres to the nearest match; NULL when there is none. */
    nearestM: doublePrecision(),
  },
  (table) => [
    uniqueIndex('place_poi_categories_poi_key_key').on(table.placePoiId, table.key),
    check(
      'place_poi_categories_key_check',
      sql`${table.key} in (${sql.raw(inList(NEARBY_SERVICE_KEYS))})`,
    ),
    check('place_poi_categories_count_check', sql`${table.count} >= 0`),
    /**
     * `present`, `count` and `nearest_m` are three views of one measurement and
     * Mongo let them disagree — `present: false` with `count: 5` was
     * representable, and the widget renders from `present`. A category is present
     * exactly when it was counted, and a distance to the nearest match exists
     * exactly then too.
     */
    check(
      'place_poi_categories_coherent_check',
      sql`(${table.present} = (${table.count} > 0))
        and (${table.nearestM} is null or ${table.present})`,
    ),
  ],
);
