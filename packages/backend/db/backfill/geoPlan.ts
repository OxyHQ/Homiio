/**
 * The geo copy plan: five Mongo collections → five Postgres tables, and the
 * named rules that decide what happens where the two disagree.
 *
 * Pure. Nothing here opens a connection or writes anything — `db/backfill/geo.ts`
 * does that. Splitting them is what lets every mapping and every resolution be
 * exercised by a test with no Mongo in sight, and it is the same split
 * `db/migrate.ts` uses for its argument parsing.
 *
 * ## Ids travel verbatim, which is the whole mechanism
 *
 * `db/MIGRATION-CONTRACT.md`: every primary key is `text`, a pre-cutover row
 * keeps its 24-char ObjectId hex EXACTLY, and there is no remapping table
 * anywhere. That is not a convenience — it is precisely how `regions.country_id`,
 * `cities.region_id`, `neighborhoods.city_id` and `cities.cover_image_id` all
 * survive the move: if an id does not change, a reference to it cannot break.
 *
 * ## FK order, and what happens if you get it wrong
 *
 * `images` → `countries` → `regions` → `cities` → `neighborhoods`. Every arrow
 * is a real foreign key with `ON DELETE restrict` (or `set null`, for the cover
 * images), so an insert whose parent is not in yet fails `23503` — loudly, half
 * way through, with rows already committed. {@link GEO_COPY_ORDER} states the
 * order once and `geo.ts` copies in it.
 *
 * `images` leads because `regions.cover_image_id` and `cities.cover_image_id`
 * reference it. It has no foreign key of its own — `images.entity_id` names five
 * different tables depending on `entity_type` and deliberately never gets one
 * (see `db/schema/images.ts`) — so nothing constrains where it sits beyond being
 * ahead of the two tables that point at it.
 *
 * ## Which images travel
 *
 * The geo hierarchy's OWN photos ({@link GEO_IMAGE_ENTITY_TYPES}), and no
 * others. The census of 2026-08-09 measured production at 171,976 images, of
 * which 170,679 are `property` and 1,297 are `city` — and every one of the 1,213
 * resolvable city covers is inside that 1,297. Property images belong to the
 * property batch and to rows that do not exist in Postgres yet; copying them
 * here would put a photo in the table ahead of the listing it belongs to.
 *
 * A cover naming an image this copy does NOT carry is not silently dropped: it
 * is written verbatim and refused by {@link coverImageForeignKeyRule}, because
 * the alternative is losing a relational link quietly, and prime directive 1 of
 * the migration contract is that no relational link is lost. A cover naming an
 * image that does not exist AT ALL is a different thing — a broken pointer, not
 * a link — and is written NULL under the frozen rule below.
 */

import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { cities, countries, neighborhoods, regions } from '../schema/geo';
import { images, IMAGE_ENTITY_TYPES } from '../schema/images';
import type { CandidateRow, RowRule } from './rowAudit';

/**
 * A Mongo document, exactly as the driver returned it.
 *
 * `unknown` values on purpose. Production may hold a shape its own Mongoose
 * schema forbids (`runValidators` is off for updates in this package), so the
 * mappers below PRESERVE whatever was stored and let `rowAudit` refuse it. A
 * mapper that coerced a bad value to `null` on the way past would hide exactly
 * the rows the audit exists to find.
 */
export type SourceDocument = Readonly<Record<string, unknown>>;

/** The image kinds the geo hierarchy owns, and therefore the ones this copy carries. */
export const GEO_IMAGE_ENTITY_TYPES = ['city', 'region', 'country'] as const satisfies
  readonly (typeof IMAGE_ENTITY_TYPES)[number][];

/**
 * The Mongo collection each table is copied from.
 *
 * Spelled out rather than read off a Mongoose model, so that this file needs no
 * model import and no assumption about how mongoose pluralises. `geo.ts` asserts
 * every one of these exists on the source database before reading, because a
 * name that matches nothing reads as "0 documents copied" — a success-shaped
 * failure, and the only kind this whole script is built to avoid.
 */
export const GEO_SOURCE_COLLECTIONS = {
  images: 'images',
  countries: 'countries',
  regions: 'regions',
  cities: 'cities',
  neighborhoods: 'neighborhoods',
} as const;

export type GeoTableName = keyof typeof GEO_SOURCE_COLLECTIONS;

/**
 * Foreign-key order. Copy in this order or fail `23503`.
 *
 * Pinned by a test against the tables' real `foreignKeys`, so a schema change
 * that adds an edge this order does not respect fails the build rather than the
 * production run.
 */
export const GEO_COPY_ORDER = [
  'images',
  'countries',
  'regions',
  'cities',
  'neighborhoods',
] as const satisfies readonly GeoTableName[];

/** The drizzle table each name refers to. */
export const GEO_TABLES: Readonly<Record<GeoTableName, PgTable>> = {
  images,
  countries,
  regions,
  cities,
  neighborhoods,
};

/**
 * Every rule under which this copy writes something other than what the source
 * holds. Each is NAMED so a report can count it, and each has a measured
 * production figure so a run that deviates is visible rather than merely
 * plausible.
 *
 * Both halves matter: the COPY applies them, and the VERIFIER applies the same
 * ones through the same mappers. A resolution the verifier does not know about
 * is reported as a fidelity failure on every row it touched
 * (`db/MIGRATION-CONTRACT.md`).
 */
export const GEO_RESOLUTIONS = {
  /**
   * A `coverImageId` naming no `images` document at all → written NULL.
   *
   * Frozen at **17 cities** by the census in `MIGRATION-CONTRACT.md`, confirmed
   * again on 2026-08-09 (1,230 cities carry a cover, 1,213 resolve). Regions
   * carry ZERO covers, so this is a cities-only rule in practice.
   *
   * The FK is real (`ON DELETE set null`), so copying the id verbatim would be a
   * `23503` mid-copy — and NULL is not an invention here, it is what the column
   * already means: "no cover".
   */
  COVER_DANGLING: 'COVER_DANGLING',
  /**
   * `bbox: []` — an empty array, not four numbers → all four bbox columns NULL.
   *
   * Measured at **4,521 of 4,521 neighborhoods**: nothing in production has ever
   * had a bounding box. `neighborhoods_bbox_complete_check` is all-or-none, and
   * four NULLs is the "none" half.
   */
  BBOX_EMPTY: 'BBOX_EMPTY',
  /**
   * A field absent from a document whose Mongoose schema declares a `default`
   * → that default is written.
   *
   * Faithful rather than generous: Mongoose applies a default at document
   * CONSTRUCTION, so a Mongo read of such a document already returns the
   * default — writing it here reproduces what every existing reader sees.
   * Measured at **0** across all five collections.
   */
  SCHEMA_DEFAULT: 'SCHEMA_DEFAULT',
  /**
   * `createdAt` absent → the ObjectId's own embedded timestamp, which IS the
   * creation instant. `updatedAt` absent → `createdAt`.
   *
   * The alternative — omitting the column and letting the target's
   * `date_trunc('milliseconds', now())` default fire — would stamp every such
   * row with the moment of the copy, i.e. would replace history with the
   * migration's own clock. Measured at **0**; the fallback is pinned by a test
   * rather than by production.
   */
  TIMESTAMP_FROM_OBJECT_ID: 'TIMESTAMP_FROM_OBJECT_ID',
} as const;

export type GeoResolution = (typeof GEO_RESOLUTIONS)[keyof typeof GEO_RESOLUTIONS];

/** Counts of each named resolution actually applied, for the run report. */
export class ResolutionLog {
  private readonly counts = new Map<GeoResolution, number>();

  applied(resolution: GeoResolution): void {
    this.counts.set(resolution, (this.counts.get(resolution) ?? 0) + 1);
  }

  toRecord(): Record<string, number> {
    return Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

/**
 * What the cover mappers need to tell a broken pointer from a link.
 *
 * `existingImageIds` is the subset of REFERENCED cover ids that name a real
 * `images` document — resolved with one `$in` query rather than by loading all
 * 171,976 image ids, which would be seventeen megabytes of strings to answer a
 * question about roughly twelve hundred.
 */
export interface CoverContext {
  readonly existingImageIds: ReadonlySet<string>;
}

// ── reading a Mongo value without changing it ──────────────────────

/**
 * Whether a value is an ObjectId, decided by DUCK TYPING rather than
 * `instanceof`.
 *
 * `instanceof` compares constructor identity, and two copies of the `bson`
 * package on one machine produce ObjectIds that fail it while being perfectly
 * ordinary ObjectIds. The hoisted linker makes that unlikely here and it costs
 * nothing to be immune to it; a false negative would send a valid `_id` to the
 * audit as "expected a string", which is a confusing way to learn about a
 * duplicated dependency.
 */
function isObjectId(value: unknown): value is { toHexString(): string; getTimestamp(): Date } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toHexString?: unknown }).toHexString === 'function' &&
    typeof (value as { getTimestamp?: unknown }).getTimestamp === 'function'
  );
}

/** The shape of an ObjectId written out — what a `text` primary key holds. */
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

/**
 * The 24-char hex of a value that names a Mongo document, or `null` when it
 * names nothing an `_id` could be.
 *
 * Used to build the `$in` list that resolves referenced cover images, so it
 * shares {@link isObjectId}'s duck typing for the reason stated there — and it
 * accepts a plain hex STRING too, because a reference stored that way is a real
 * reference the raw collection handle would otherwise fail to match.
 */
export function toObjectIdHex(value: unknown): string | null {
  if (isObjectId(value)) return value.toHexString();
  if (typeof value === 'string' && OBJECT_ID_HEX.test(value)) return value;
  return null;
}

/**
 * An id as the target stores it: the 24-char hex, verbatim.
 *
 * A value that is neither an ObjectId nor a string is returned UNCHANGED so the
 * audit reports it. Returning `null` instead would put a NOT NULL violation
 * where the real fault is a shape nobody expected, and would quietly erase a
 * foreign key on a nullable column.
 */
function idValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return isObjectId(value) ? value.toHexString() : value;
}

/** A dotted path (`coordinates.lat`), or `undefined` where any level is absent. */
function readPath(document: SourceDocument, path: string): unknown {
  let current: unknown = document;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** A value that may legitimately be absent, normalised to an explicit `null`. */
function optional(document: SourceDocument, path: string): unknown {
  const value = readPath(document, path);
  return value === undefined ? null : value;
}

/**
 * A value whose Mongoose schema declares a `default`, with that default applied
 * when the stored document has none.
 *
 * `null` counts as absent here, and deliberately: these columns are all NOT NULL
 * in the target, so a stored `null` is the same "the document does not say" a
 * missing key is — and Mongoose would hydrate both to the default.
 */
function withSchemaDefault(
  document: SourceDocument,
  path: string,
  fallback: unknown,
  log: ResolutionLog,
): unknown {
  const value = readPath(document, path);
  if (value !== undefined && value !== null) return value;
  log.applied(GEO_RESOLUTIONS.SCHEMA_DEFAULT);
  return fallback;
}

/** `created_at` — the stored value, or the id's own embedded creation instant. */
function createdAtValue(document: SourceDocument, log: ResolutionLog): unknown {
  const stored = readPath(document, 'createdAt');
  if (stored !== undefined && stored !== null) return stored;
  const id = document._id;
  if (isObjectId(id)) {
    log.applied(GEO_RESOLUTIONS.TIMESTAMP_FROM_OBJECT_ID);
    return id.getTimestamp();
  }
  // No id to fall back to. Returned as-is so the audit reports the NOT NULL
  // violation rather than this function inventing a timestamp.
  return stored ?? null;
}

/** `updated_at` — the stored value, else whatever `created_at` resolved to. */
function updatedAtValue(document: SourceDocument, createdAt: unknown, log: ResolutionLog): unknown {
  const stored = readPath(document, 'updatedAt');
  if (stored !== undefined && stored !== null) return stored;
  log.applied(GEO_RESOLUTIONS.TIMESTAMP_FROM_OBJECT_ID);
  return createdAt;
}

/**
 * A cover image reference: verbatim when the image exists, NULL when it names
 * nothing at all.
 *
 * The two cases are told apart on purpose — see the module doc. An image that
 * exists but is not carried by this copy keeps its id here and is refused by
 * {@link coverImageForeignKeyRule}; only a pointer at nothing becomes NULL.
 */
function coverImageValue(
  document: SourceDocument,
  context: CoverContext,
  log: ResolutionLog,
): unknown {
  const id = idValue(readPath(document, 'coverImageId'));
  if (id === null) return null;
  if (typeof id === 'string' && !context.existingImageIds.has(id)) {
    log.applied(GEO_RESOLUTIONS.COVER_DANGLING);
    return null;
  }
  return id;
}

// ── the five mappers ───────────────────────────────────────────────

/** `countries` ← `models/schemas/CountrySchema.ts`. */
export function toCountryRow(document: SourceDocument, log: ResolutionLog): CandidateRow {
  const createdAt = createdAtValue(document, log);
  return {
    id: idValue(document._id),
    code: optional(document, 'code'),
    name: optional(document, 'name'),
    currency: withSchemaDefault(document, 'currency', 'EUR', log),
    flag: optional(document, 'flag'),
    defaultLocale: optional(document, 'defaultLocale'),
    isActive: withSchemaDefault(document, 'isActive', true, log),
    createdAt,
    updatedAt: updatedAtValue(document, createdAt, log),
  };
}

/**
 * `regions` ← `models/schemas/RegionSchema.ts`.
 *
 * `imageIds[]` is NOT carried. The relation already exists as
 * `images.(entity_type, entity_id)`, so the array was a second and disagreeable
 * copy of it — `db/MIGRATION-CONTRACT.md` deletes the column, and the census
 * measured **0 elements across all 211 regions** anyway.
 */
export function toRegionRow(
  document: SourceDocument,
  context: CoverContext,
  log: ResolutionLog,
): CandidateRow {
  const createdAt = createdAtValue(document, log);
  return {
    id: idValue(document._id),
    countryId: idValue(readPath(document, 'countryId')),
    code: optional(document, 'code'),
    name: optional(document, 'name'),
    coverImageId: coverImageValue(document, context, log),
    isActive: withSchemaDefault(document, 'isActive', true, log),
    createdAt,
    updatedAt: updatedAtValue(document, createdAt, log),
  };
}

/**
 * `cities` ← `models/schemas/CitySchema.ts`.
 *
 * `coordinates: { lat, lng }` becomes NAMED `latitude` / `longitude` columns:
 * a named pair cannot be transposed, which an ordered one can. `imageIds[]` is
 * dropped for the same reason as on `regions`.
 *
 * `properties_count` is copied rather than recomputed. Properties do not exist
 * in Postgres yet, so recomputing it here would write zero to every row and
 * flatten the sort key `GET /api/cities`, `/popular` and `/search` all order by.
 * The stored value is the last count Mongo computed, which is the same number
 * the Mongo-backed endpoint was serving.
 */
export function toCityRow(
  document: SourceDocument,
  context: CoverContext,
  log: ResolutionLog,
): CandidateRow {
  const createdAt = createdAtValue(document, log);
  return {
    id: idValue(document._id),
    name: optional(document, 'name'),
    countryId: idValue(readPath(document, 'countryId')),
    regionId: idValue(readPath(document, 'regionId')),
    latitude: optional(document, 'coordinates.lat'),
    longitude: optional(document, 'coordinates.lng'),
    timezone: optional(document, 'timezone'),
    population: optional(document, 'population'),
    description: optional(document, 'description'),
    averageRent: optional(document, 'averageRent'),
    currency: withSchemaDefault(document, 'currency', 'EUR', log),
    coverImageId: coverImageValue(document, context, log),
    isActive: withSchemaDefault(document, 'isActive', true, log),
    propertiesCount: withSchemaDefault(document, 'propertiesCount', 0, log),
    // `lastUpdated` and `updated_at` are two different facts (CONVENTIONS.md):
    // one moves when the count is recomputed, the other on any write. Mongoose
    // defaults this to `Date.now` at construction, which for a document that
    // never had its count recomputed is its creation instant.
    lastUpdated: withSchemaDefault(document, 'lastUpdated', createdAt, log),
    createdAt,
    updatedAt: updatedAtValue(document, createdAt, log),
  };
}

/**
 * `neighborhoods` ← `models/schemas/NeighborhoodSchema.ts`.
 *
 * `bbox: [west, south, east, north]` becomes four NAMED columns for the same
 * reason `coordinates` does on `cities`: `[2.1, 41.3, 2.2, 41.4]` and
 * `[41.3, 2.1, 41.4, 2.2]` are both valid arrays and only one is Barcelona.
 *
 * Anything that is not exactly four elements yields four NULLs — which for an
 * empty array is the Mongo validator's own "length 0 or 4" rule restated, and
 * for any other length is a shape the source schema forbids. The latter is
 * COUNTED under {@link GEO_RESOLUTIONS.BBOX_EMPTY} rather than passed through,
 * because a partial box is not a box.
 */
export function toNeighborhoodRow(document: SourceDocument, log: ResolutionLog): CandidateRow {
  const createdAt = createdAtValue(document, log);
  const bbox = readPath(document, 'bbox');
  const box = Array.isArray(bbox) && bbox.length === 4 ? bbox : null;
  if (box === null && bbox !== undefined && bbox !== null) log.applied(GEO_RESOLUTIONS.BBOX_EMPTY);

  return {
    id: idValue(document._id),
    cityId: idValue(readPath(document, 'cityId')),
    name: optional(document, 'name'),
    latitude: optional(document, 'centroid.lat'),
    longitude: optional(document, 'centroid.lng'),
    bboxWest: box === null ? null : box[0],
    bboxSouth: box === null ? null : box[1],
    bboxEast: box === null ? null : box[2],
    bboxNorth: box === null ? null : box[3],
    isActive: withSchemaDefault(document, 'isActive', true, log),
    createdAt,
    updatedAt: updatedAtValue(document, createdAt, log),
  };
}

/**
 * `images` ← `models/schemas/ImageSchema.ts`.
 *
 * The two `_id: false` sub-documents (`keys`, `urls`) flatten into eight named
 * columns. The variant set is CLOSED and known at schema time, so this is the
 * honest shape — and the column names keep the Mongo path (`keys.medium` →
 * `keys_medium`), which is what lets this mapping be read against the source
 * schema line by line.
 */
export function toImageRow(document: SourceDocument, log: ResolutionLog): CandidateRow {
  const createdAt = createdAtValue(document, log);
  return {
    id: idValue(document._id),
    entityType: optional(document, 'entityType'),
    entityId: idValue(readPath(document, 'entityId')),
    keysOriginal: optional(document, 'keys.original'),
    keysSmall: optional(document, 'keys.small'),
    keysMedium: optional(document, 'keys.medium'),
    keysLarge: optional(document, 'keys.large'),
    urlsOriginal: optional(document, 'urls.original'),
    urlsSmall: optional(document, 'urls.small'),
    urlsMedium: optional(document, 'urls.medium'),
    urlsLarge: optional(document, 'urls.large'),
    width: optional(document, 'width'),
    height: optional(document, 'height'),
    format: optional(document, 'format'),
    bytes: optional(document, 'bytes'),
    caption: optional(document, 'caption'),
    isPrimary: withSchemaDefault(document, 'isPrimary', false, log),
    order: withSchemaDefault(document, 'order', 0, log),
    createdAt,
    updatedAt: updatedAtValue(document, createdAt, log),
  };
}

// ── the constraints column metadata cannot express ─────────────────

/**
 * A foreign key, as a rule the audit can check before anything is inserted.
 *
 * `parentIds` is the id set of the table copied BEFORE this one, so this is the
 * same question `23503` answers — asked while it is still a report rather than a
 * half-finished copy.
 */
export function foreignKeyRule(
  constraint: string,
  column: string,
  parentIds: ReadonlySet<string>,
  nullable: boolean,
): RowRule {
  return {
    name: constraint,
    reason: nullable
      ? `names no row in the referenced table (23503); null is allowed, a dangling id is not`
      : `names no row in the referenced table (23503)`,
    holds: (row) => {
      const value = row[column];
      if (value === null || value === undefined) return nullable;
      return typeof value === 'string' && parentIds.has(value);
    },
    offendingValue: (row) => row[column],
  };
}

/**
 * `cities.cover_image_id` / `regions.cover_image_id` must name an image THIS
 * COPY carries.
 *
 * Separate from a plain {@link foreignKeyRule} only in its message, and that
 * message is the point: a cover reaching here non-null and unmatched is not a
 * broken pointer (those became NULL in the mapper) — it is a live link to an
 * image outside {@link GEO_IMAGE_ENTITY_TYPES}, which is a shape nobody has
 * measured. Refusing is right: nulling it would lose a link, and carrying the
 * image would put a property's photo on a city.
 */
export function coverImageForeignKeyRule(
  constraint: string,
  carriedImageIds: ReadonlySet<string>,
): RowRule {
  return {
    name: constraint,
    reason:
      'names an image this copy does not carry — it exists but is not one of ' +
      `${GEO_IMAGE_ENTITY_TYPES.join('/')}. Refused rather than nulled: that ` +
      'would lose a live relational link (23503)',
    holds: (row) => {
      const value = row.coverImageId;
      if (value === null || value === undefined) return true;
      return typeof value === 'string' && carriedImageIds.has(value);
    },
    offendingValue: (row) => row.coverImageId,
  };
}

/**
 * `neighborhoods_bbox_complete_check` — all four bbox columns, or none.
 *
 * Restated here because it is a TABLE-level CHECK: no single column's metadata
 * carries it, so `rowAudit` cannot derive it. Written to match the constraint
 * exactly, including the trap CONVENTIONS.md names — a CHECK passes on NULL, so
 * the positive branch spells out every column.
 */
export const bboxCompleteRule: RowRule = {
  name: 'neighborhoods_bbox_complete_check',
  reason: 'bbox is partially set — the CHECK is all four columns or none (23514)',
  holds: (row) => {
    const set = [row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth].filter(
      (value) => value !== null && value !== undefined,
    ).length;
    return set === 0 || set === 4;
  },
  offendingValue: (row) => [row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth],
};

/**
 * The columns of a table, in declaration order — what the field-by-field
 * verifier compares and what a report names.
 */
export function columnNames(table: PgTable): string[] {
  return Object.keys(getTableColumns(table));
}
