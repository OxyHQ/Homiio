/**
 * Copy the geo reference data — countries, regions, cities, neighborhoods and
 * the geo hierarchy's own images — from Mongo to Postgres.
 *
 * Run as a one-shot, exactly like `db/migrate.ts`, and compiled into the same
 * image (`dist/db/backfill/geo.js`). The runtime image has no ts-node, so a
 * script that is not compiled cannot be run in production at all; `db/` is the
 * directory `tsconfig.build.json` emits, and `scripts/` is deliberately excluded
 * from it — see the note at the bottom of this comment.
 *
 *   node packages/backend/dist/db/backfill/geo.js \
 *     --source-database=homiio-production --target-database=homiio
 *
 *   …--audit-only     measure, write nothing at all
 *   …--verify-only    compare an already-copied target against the source
 *   …--reconcile      copy, then bring rows already present back into line
 *   …--sample=<n>     rows per table in the field-by-field comparison (default 200)
 *
 * ## Why this exists
 *
 * `controllers/cityController.ts` and `controllers/neighborhoodController.ts`
 * were ported to read Postgres while the `homiio` database held schema and no
 * geo rows, so `GET /api/cities`, `/cities/popular`, `/cities/search` and
 * `/cities/lookup` all answered empty. Nothing was lost — Mongo is untouched and
 * still authoritative — but the read path had moved off it.
 *
 * ## What it will not do
 *
 * **It never writes to Mongo.** The copy READS; Mongo stays intact and
 * authoritative through the whole migration and through any rollback, which is
 * what makes a rollback "redeploy the pinned revision" rather than a data
 * restore (`db/MIGRATION-CONTRACT.md`).
 *
 * **It never mints an id.** Every `_id` travels verbatim into the `text` primary
 * key, which is exactly how `regions.country_id`, `cities.region_id`,
 * `neighborhoods.city_id` and `cities.cover_image_id` survive without a
 * remapping table.
 *
 * **It never runs an insert the audit has not seen.** The audit reads the target
 * tables' own column metadata and reports EVERY refused value in one pass —
 * grouped, counted, with examples — before the first row is written. Mongoose
 * does not run validators on updates in this package, so production can hold
 * values its own schema forbids; discovering that by inserting means failing
 * half way with a driver error naming one row.
 *
 * ## Both database names are required, and they catch different mistakes
 *
 * `--target-database` is the migrator's guard, reused rather than
 * re-implemented (`assertMigrationTarget` from `@oxyhq/db/migrate`, issued as
 * the FIRST statement on the connection). `--source-database` is its mirror on
 * the Mongo side: a copy pointed at a stale rehearsal database reads plausible
 * rows and writes them into production, and the only thing standing between
 * those two facts is somebody stating which database they believe they are
 * reading.
 *
 * ## Idempotent, so a re-run converges
 *
 * Every insert is `ON CONFLICT DO NOTHING`. A second run inserts nothing and
 * reports `skippedExisting`; a run interrupted half way completes on the next
 * attempt. `DO NOTHING` without a conflict target covers the primary key AND the
 * unique indexes, which is what makes the verify step load-bearing rather than
 * decorative: a row silently skipped for any reason shows up there as missing.
 *
 * ## Why `db/backfill/` and not `scripts/`
 *
 * `packages/backend/tsconfig.build.json` EXCLUDES `scripts` from the emitted
 * `dist` on purpose — those are developer one-shots that must never reach the
 * production image. `dist/db/migrate.js` is the working precedent for a one-shot
 * that DOES have to run in production, and this is the second one.
 */

import mongoose from 'mongoose';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { count, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { assertMigrationTarget, readTargetDatabase } from '@oxyhq/db/migrate';

import { Logger } from '../../utils/logger';
import { DATABASE_CASING } from '../casing';
import type { Database } from '../postgres';
import * as schema from '../schema';
import {
  bboxCompleteRule,
  columnNames,
  coverImageForeignKeyRule,
  foreignKeyRule,
  GEO_COPY_ORDER,
  GEO_IMAGE_ENTITY_TYPES,
  GEO_SOURCE_COLLECTIONS,
  GEO_TABLES,
  ResolutionLog,
  toCityRow,
  toCountryRow,
  toImageRow,
  toNeighborhoodRow,
  toObjectIdHex,
  toRegionRow,
  type CoverContext,
  type GeoTableName,
  type SourceDocument,
} from './geoPlan';
import { auditRows, describeViolations, type CandidateRow, type RowRule } from './rowAudit';

const logger = new Logger('GeoBackfill');

/** Seconds to wait for in-flight queries before forcing the socket shut. */
const CLOSE_TIMEOUT_SECONDS = 5;

/**
 * Rows per multi-row `INSERT`.
 *
 * Postgres binds at most 65,535 parameters per statement and the widest table
 * here (`images`) has 20 columns, so 500 rows is 10,000 parameters — an order of
 * magnitude of headroom, and small enough that a failure names a bounded batch.
 */
const INSERT_BATCH_ROWS = 500;

/** Ids per `IN (...)` when checking presence. Same ceiling, one parameter each. */
const LOOKUP_BATCH_IDS = 1000;

/** Rows per table compared field by field, unless `--sample=` says otherwise. */
const DEFAULT_SAMPLE_ROWS = 200;

/** Ids listed in a report when something is missing. Enough to grep for. */
const MAX_REPORTED_IDS = 5;

/** The handle `mongoose.connection.db` publishes once connected. */
export type MongoDatabase = NonNullable<typeof mongoose.connection.db>;

/** What one run was asked to do. */
export type Mode = 'copy' | 'reconcile' | 'audit-only' | 'verify-only';

/** Per-table outcome of the copy. */
export interface CopyReport {
  readonly table: GeoTableName;
  readonly read: number;
  readonly inserted: number;
  readonly skippedExisting: number;
}

/** Per-table outcome of a reconcile pass. */
export interface ReconcileReport {
  readonly table: GeoTableName;
  /** Rows present in both stores and compared column by column. */
  readonly compared: number;
  /** Rows that differed and were brought back into line with the source. */
  readonly updated: number;
  /** How many rows each column differed on — what was actually repaired. */
  readonly columns: Readonly<Record<string, number>>;
}

/** Per-table outcome of the verification. */
export interface VerifyReport {
  readonly table: GeoTableName;
  readonly sourceRows: number;
  readonly targetRows: number;
  readonly missing: number;
  readonly missingIds: readonly string[];
  readonly compared: number;
  /**
   * How many mismatches the sample found IN TOTAL.
   *
   * Reported beside the truncated list below, because a list capped at five
   * reads identically whether five rows drifted or every row did — and the
   * scale is the first thing an operator needs.
   */
  readonly mismatchCount: number;
  readonly mismatches: readonly string[];
}

/** What one run did, whichever mode it ran in. */
export interface GeoBackfillReport {
  readonly mode: Mode;
  readonly read: Readonly<Record<GeoTableName, number>>;
  readonly resolutions: Readonly<Record<string, number>>;
  readonly copied: readonly CopyReport[];
  readonly reconciled: readonly ReconcileReport[];
  readonly verified: readonly VerifyReport[];
}

// ── arguments ──────────────────────────────────────────────────────

/**
 * The `--source-database=<name>` argument.
 *
 * The mirror of `readTargetDatabase`, and required for the same reason stated
 * from the other side: which Mongo database this process reads is decided
 * entirely by `MONGODB_URI`, so a run that does not state its intended source
 * cannot be checked against it. Reading the wrong one does not fail — it copies
 * a rehearsal's rows into production and exits 0.
 *
 * @throws {Error} When absent or empty.
 */
export function readSourceDatabase(argv: readonly string[]): string {
  const prefix = '--source-database=';
  const flag = argv.find((argument) => argument.startsWith(prefix));
  const source = flag?.slice(prefix.length).trim();
  if (source === undefined || source.length === 0) {
    throw new Error(
      'Refusing to read a backfill source: no --source-database=<name> in the ' +
      'arguments. Which Mongo database this reads is decided entirely by ' +
      'MONGODB_URI, so a run that does not state its intended source cannot be ' +
      'checked against it. Example: `--source-database=homiio-production`.',
    );
  }
  return source;
}

/**
 * Which of the four things this run does.
 *
 * The default is `copy`, which only ever INSERTS. `--reconcile` is the mode that
 * may overwrite a row already in the target, and it is explicit for that reason:
 * a tool that silently rewrites rows it did not write is a synchroniser, not a
 * copy, and the two want different amounts of trust.
 *
 * @throws {Error} When more than one is given — they ask for different runs, and
 *   picking one would obey half the command line.
 */
export function readMode(argv: readonly string[]): Mode {
  const requested = (
    [
      ['--audit-only', 'audit-only'],
      ['--verify-only', 'verify-only'],
      ['--reconcile', 'reconcile'],
    ] as const
  ).filter(([flag]) => argv.includes(flag));

  if (requested.length > 1) {
    throw new Error(
      `${requested.map(([flag]) => flag).join(' and ')} are mutually exclusive.`,
    );
  }
  return requested[0]?.[1] ?? 'copy';
}

/**
 * The `--sample=<n>` argument, or {@link DEFAULT_SAMPLE_ROWS}.
 *
 * @throws {Error} When present but not a positive integer — a typo that silently
 *   became "compare nothing" would make the verifier report success over a
 *   comparison it never made.
 */
export function readSampleSize(argv: readonly string[]): number {
  const prefix = '--sample=';
  const flag = argv.find((argument) => argument.startsWith(prefix));
  if (flag === undefined) return DEFAULT_SAMPLE_ROWS;
  const value = Number(flag.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--sample must be a positive integer, got ${flag.slice(prefix.length)}.`);
  }
  return value;
}

// ── the source side of the two guards ──────────────────────────────

/**
 * Check the named source against the Mongo database actually connected, and
 * against the collections it must contain.
 *
 * Mongo has no server-side `current_database()` — the database a command targets
 * is chosen by the CLIENT, from the connection string — so the name comparison
 * is against the driver's own resolved `databaseName`, which IS what every read
 * below will use. The collection check is the half that catches a database with
 * the right name and the wrong contents: a source collection that does not exist
 * reads as "0 documents copied", and a success-shaped failure is the one thing
 * this whole script is built to avoid.
 *
 * @throws {Error} When the connected database is not `expected`, or when any
 *   source collection is missing.
 */
export async function assertMigrationSource(
  database: MongoDatabase,
  expected: string,
): Promise<void> {
  const actual = database.databaseName;
  if (actual !== expected) {
    throw new Error(
      `Refusing to copy: the run expects to read ${JSON.stringify(expected)} but ` +
      `MONGODB_URI reaches ${JSON.stringify(actual)}. One of those two is wrong ` +
      'and this tool cannot tell which. Nothing has been read and nothing has ' +
      'been written.',
    );
  }

  const present = new Set((await database.listCollections().toArray()).map((entry) => entry.name));
  const missing = Object.values(GEO_SOURCE_COLLECTIONS).filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to copy: ${JSON.stringify(actual)} has no ${missing.join(', ')} ` +
      'collection. An absent collection reads as zero documents, which is ' +
      'indistinguishable from an empty one — and this run would report a ' +
      'successful copy of nothing.',
    );
  }
}

// ── reading the source ─────────────────────────────────────────────

/** Every document this copy will consider, plus what the cover mappers need. */
export interface SourceData {
  readonly documents: Readonly<Record<GeoTableName, readonly SourceDocument[]>>;
  readonly cover: CoverContext;
}

/**
 * Read all five collections, then resolve which referenced cover images exist.
 *
 * Everything is loaded before anything is mapped, which is what lets the audit
 * cover the WHOLE plan — every table, every foreign key — before the first
 * insert. The volume makes that free: 7 countries, 211 regions, 1,660 cities,
 * 4,521 neighborhoods and 1,297 geo images is under eight thousand documents.
 *
 * **That shape is bounded by THIS batch and does not generalise — do not copy it
 * into a larger one.** The task this runs on is 512 CPU / 1024 MB, and the rest
 * of the migration is two orders of magnitude bigger: 170,679 property images
 * and 17,644 properties each carrying an embedded `images[]`. Loading those
 * before mapping is an OOM, not a slow run. A large batch has to stream with a
 * cursor and keep only the parent-id SETS the foreign-key rules need, in two
 * passes, so that "audit the whole plan before the first insert" still holds.
 */
export async function loadSource(database: MongoDatabase): Promise<SourceData> {
  const read = async (collection: string, filter: Record<string, unknown> = {}) =>
    (await database.collection(collection).find(filter).toArray()) as SourceDocument[];

  const documents = {
    // Only the geo hierarchy's own photos — see `geoPlan.ts`. Property images
    // belong to rows Postgres does not have yet.
    images: await read(GEO_SOURCE_COLLECTIONS.images, {
      entityType: { $in: [...GEO_IMAGE_ENTITY_TYPES] },
    }),
    countries: await read(GEO_SOURCE_COLLECTIONS.countries),
    regions: await read(GEO_SOURCE_COLLECTIONS.regions),
    cities: await read(GEO_SOURCE_COLLECTIONS.cities),
    neighborhoods: await read(GEO_SOURCE_COLLECTIONS.neighborhoods),
  } as const;

  return {
    documents,
    cover: {
      existingImageIds: await resolveReferencedImages(database, [
        ...documents.regions,
        ...documents.cities,
      ]),
    },
  };
}

/**
 * Which of the referenced `coverImageId`s name a real `images` document.
 *
 * One `$in` over the ~1,230 referenced ids rather than a scan of all 171,976
 * image ids: the question is only ever asked about ids something points at.
 *
 * The `$in` list carries ObjectIds. A cover stored as a 24-char STRING is
 * CONVERTED rather than dropped — the raw collection handle does no casting, so
 * a string would silently match nothing and the link would be nulled as
 * "dangling" when it is not. A cover of any other shape is left out of the query
 * entirely: it cannot match an ObjectId `_id`, and the mapper hands it to the
 * audit verbatim, where the foreign-key rule REFUSES it. That is the difference
 * that matters — an unmatchable reference stops the run instead of quietly
 * becoming NULL.
 */
async function resolveReferencedImages(
  database: MongoDatabase,
  documents: readonly SourceDocument[],
): Promise<ReadonlySet<string>> {
  const referenced: mongoose.Types.ObjectId[] = [];
  for (const document of documents) {
    const hex = toObjectIdHex(document.coverImageId);
    if (hex !== null) referenced.push(new mongoose.Types.ObjectId(hex));
  }
  if (referenced.length === 0) return new Set();

  const found = await database
    .collection(GEO_SOURCE_COLLECTIONS.images)
    .find({ _id: { $in: referenced } }, { projection: { _id: 1 } })
    .toArray();
  return new Set(found.map((document) => String(document._id)));
}

// ── mapping and auditing ───────────────────────────────────────────

/** Every candidate row, in copy order, plus the resolutions that produced them. */
export interface PlannedRows {
  readonly rows: Readonly<Record<GeoTableName, readonly CandidateRow[]>>;
  readonly resolutions: Record<string, number>;
}

/** Apply the five mappers. Pure — see `geoPlan.ts` for every rule this obeys. */
export function buildRows(source: SourceData): PlannedRows {
  const log = new ResolutionLog();
  const rows = {
    images: source.documents.images.map((document) => toImageRow(document, log)),
    countries: source.documents.countries.map((document) => toCountryRow(document, log)),
    regions: source.documents.regions.map((document) => toRegionRow(document, source.cover, log)),
    cities: source.documents.cities.map((document) => toCityRow(document, source.cover, log)),
    neighborhoods: source.documents.neighborhoods.map((document) =>
      toNeighborhoodRow(document, log),
    ),
  } as const;
  return { rows, resolutions: log.toRecord() };
}

/** The id of every row a table will contribute, for the foreign-key rules. */
function idsOf(rows: readonly CandidateRow[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row.id === 'string') ids.add(row.id);
  }
  return ids;
}

/**
 * Audit every table against its own columns, its table-level CHECKs and its
 * foreign keys.
 *
 * The foreign-key rules are checked against the ids THIS RUN will insert rather
 * than against what the target already holds, which is the stricter question: a
 * parent that is present only because a previous partial run inserted it still
 * has to be in the plan, or the plan is not self-consistent.
 *
 * @returns One line per violation, empty when the target accepts every row.
 */
export function auditPlan(planned: PlannedRows): string[] {
  const countryIds = idsOf(planned.rows.countries);
  const regionIds = idsOf(planned.rows.regions);
  const cityIds = idsOf(planned.rows.cities);
  const imageIds = idsOf(planned.rows.images);

  const rules: Readonly<Record<GeoTableName, readonly RowRule[]>> = {
    images: [],
    countries: [],
    regions: [
      foreignKeyRule('regions_country_id_countries_id_fk', 'countryId', countryIds, false),
      coverImageForeignKeyRule('regions_cover_image_id_images_id_fk', imageIds),
    ],
    cities: [
      foreignKeyRule('cities_country_id_countries_id_fk', 'countryId', countryIds, false),
      foreignKeyRule('cities_region_id_regions_id_fk', 'regionId', regionIds, false),
      coverImageForeignKeyRule('cities_cover_image_id_images_id_fk', imageIds),
    ],
    neighborhoods: [
      foreignKeyRule('neighborhoods_city_id_cities_id_fk', 'cityId', cityIds, false),
      bboxCompleteRule,
    ],
  };

  const lines: string[] = [];
  for (const table of GEO_COPY_ORDER) {
    const violations = auditRows(GEO_TABLES[table], planned.rows[table], rules[table]);
    lines.push(...describeViolations(table, violations));
  }
  return lines;
}

// ── writing ────────────────────────────────────────────────────────

/**
 * Insert audited rows, `ON CONFLICT DO NOTHING`, in batches.
 *
 * The rows arrive loosely typed because {@link auditPlan} is what proves their
 * shape — it reads the TARGET's own column metadata, so a row that survives it
 * is one Postgres accepts. The single narrowing here is that proof cashed in;
 * calling this without auditing first would move the failure from a report into
 * a driver error part way through a copy.
 *
 * @returns How many rows were actually written.
 */
async function insertRows(
  database: Database,
  table: PgTable,
  rows: readonly CandidateRow[],
): Promise<number> {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += INSERT_BATCH_ROWS) {
    const batch = rows.slice(start, start + INSERT_BATCH_ROWS) as PgTable['$inferInsert'][];
    const written = await database
      .insert(table)
      .values(batch)
      // No conflict TARGET: this covers the primary key and every unique index,
      // so a re-run converges whichever of them a row would have collided on.
      // What makes that safe rather than lossy is the verify step, which asks
      // whether every source row is present rather than trusting this count.
      .onConflictDoNothing()
      .returning({ id: getTableColumns(table).id });
    inserted += written.length;
  }
  return inserted;
}

/** Copy every table in foreign-key order. */
async function copyPlan(database: Database, planned: PlannedRows): Promise<CopyReport[]> {
  const reports: CopyReport[] = [];
  for (const table of GEO_COPY_ORDER) {
    const rows = planned.rows[table];
    const inserted = await insertRows(database, GEO_TABLES[table], rows);
    const report: CopyReport = {
      table,
      read: rows.length,
      inserted,
      skippedExisting: rows.length - inserted,
    };
    logger.info(`Copied ${table}`, report);
    reports.push(report);
  }
  return reports;
}

// ── reconciling ────────────────────────────────────────────────────

/**
 * Bring rows that are ALREADY in the target back into line with the source.
 *
 * `copyPlan` is `ON CONFLICT DO NOTHING` and therefore cannot repair anything;
 * that is the right default, and it is also a gap the moment a target holds rows
 * this script did not write. Two ways that happens, and both are real:
 *
 *  - **Somebody else populated the table.** During the incident this script was
 *    written for, an earlier hand copy had already loaded the four geo tables
 *    with every `cover_image_id` NULL (it had no `images` rows to point at, so
 *    copying them would have been a `23503`). Every row was present, so
 *    `DO NOTHING` skipped all 1,660 — and `/api/cities/popular`, whose whole
 *    filter is `cover_image_id is not null`, kept answering `[]`.
 *  - **Mongo is still live.** It stays authoritative until the cutover, so a row
 *    copied yesterday can be edited today and the target is stale by definition.
 *
 * **Every column is written, not only the ones that differ.** Partly because
 * convergence is the point, and partly for a specific trap: `updated_at` carries
 * drizzle's `$onUpdate`, so an `UPDATE` that does not name it explicitly stamps
 * the row with the moment of the repair — replacing the historical value this
 * whole migration exists to preserve. Writing the full row makes that
 * impossible rather than remembered.
 *
 * Never runs unless `--reconcile` asked for it, and never on a row the audit did
 * not approve.
 */
async function reconcilePlan(
  database: Database,
  planned: PlannedRows,
): Promise<ReconcileReport[]> {
  const reports: ReconcileReport[] = [];

  for (const table of GEO_COPY_ORDER) {
    const target = GEO_TABLES[table];
    const idColumn = getTableColumns(target).id;
    const columns = columnNames(target);
    const rows = planned.rows[table].filter(
      (row): row is CandidateRow & { id: string } => typeof row.id === 'string',
    );

    // Read the stored rows first, so the comparison is against what is really
    // there rather than against what a previous step believes it wrote.
    const stored = new Map<string, CandidateRow>();
    for (let start = 0; start < rows.length; start += LOOKUP_BATCH_IDS) {
      const batch = rows.slice(start, start + LOOKUP_BATCH_IDS).map((row) => row.id);
      const found = await database.select().from(target).where(inArray(idColumn, batch));
      for (const row of found) stored.set(String((row as CandidateRow).id), row as CandidateRow);
    }

    const differing: Record<string, number> = {};
    let updated = 0;
    for (const row of rows) {
      const current = stored.get(row.id);
      if (current === undefined) continue;

      const changed = columns.filter((column) => !sameValue(row[column], current[column]));
      if (changed.length === 0) continue;
      for (const column of changed) differing[column] = (differing[column] ?? 0) + 1;

      const values = Object.fromEntries(
        columns.filter((column) => column !== 'id').map((column) => [column, row[column]]),
      );
      await database
        .update(target)
        .set(values as Partial<PgTable['$inferInsert']>)
        .where(eq(idColumn, row.id));
      updated += 1;
    }

    const report: ReconcileReport = {
      table,
      compared: stored.size,
      updated,
      columns: differing,
    };
    logger.info(`Reconciled ${table}`, report);
    reports.push(report);
  }
  return reports;
}

// ── verifying ──────────────────────────────────────────────────────

/** Which of `ids` the target already holds. */
async function presentIds(
  database: Database,
  table: PgTable,
  ids: readonly string[],
): Promise<Set<string>> {
  const idColumn = getTableColumns(table).id;
  const present = new Set<string>();
  for (let start = 0; start < ids.length; start += LOOKUP_BATCH_IDS) {
    const batch = ids.slice(start, start + LOOKUP_BATCH_IDS);
    const found = await database.select({ id: idColumn }).from(table).where(inArray(idColumn, batch));
    for (const row of found) present.add(String(row.id));
  }
  return present;
}

/**
 * Whether a stored value equals the value the mapper produced.
 *
 * `Date` by instant rather than by identity — postgres.js hands back a new
 * `Date` for every read, so `===` would report every timestamp as a mismatch and
 * the comparison would be worthless in exactly the way that looks thorough.
 */
function sameValue(expected: unknown, actual: unknown): boolean {
  if (expected instanceof Date || actual instanceof Date) {
    return (
      expected instanceof Date &&
      actual instanceof Date &&
      expected.getTime() === actual.getTime()
    );
  }
  return expected === actual;
}

/**
 * Compare a spread-out sample of rows field by field.
 *
 * The sample is a STRIDE across the id-sorted rows rather than the first N: ids
 * are ObjectIds, so they sort by creation time, and the first N would be the
 * oldest rows only — the cohort least likely to hold whatever a later code
 * change introduced.
 */
async function compareSample(
  database: Database,
  table: PgTable,
  rows: readonly CandidateRow[],
  sampleSize: number,
): Promise<{ compared: number; mismatches: string[] }> {
  const ordered = [...rows]
    .filter((row): row is CandidateRow & { id: string } => typeof row.id === 'string')
    .sort((left, right) => left.id.localeCompare(right.id));
  if (ordered.length === 0) return { compared: 0, mismatches: [] };

  const stride = Math.max(1, Math.floor(ordered.length / sampleSize));
  const sample: (CandidateRow & { id: string })[] = [];
  for (let index = 0; index < ordered.length && sample.length < sampleSize; index += stride) {
    sample.push(ordered[index]);
  }

  const idColumn = getTableColumns(table).id;
  const stored = await database
    .select()
    .from(table)
    .where(inArray(idColumn, sample.map((row) => row.id)));
  const byId = new Map(stored.map((row) => [String((row as CandidateRow).id), row as CandidateRow]));

  const mismatches: string[] = [];
  for (const expected of sample) {
    const actual = byId.get(expected.id);
    if (actual === undefined) {
      mismatches.push(`${expected.id}: absent from the target`);
      continue;
    }
    for (const column of columnNames(table)) {
      if (!sameValue(expected[column], actual[column])) {
        mismatches.push(
          `${expected.id}.${column}: expected ${JSON.stringify(expected[column])}, stored ${JSON.stringify(actual[column])}`,
        );
      }
    }
  }
  return { compared: sample.length, mismatches };
}

/** Counts, presence of every source row, and a field-by-field sample. */
async function verifyPlan(
  database: Database,
  planned: PlannedRows,
  sampleSize: number,
): Promise<VerifyReport[]> {
  const reports: VerifyReport[] = [];
  for (const table of GEO_COPY_ORDER) {
    const rows = planned.rows[table];
    const target = GEO_TABLES[table];
    const ids = rows.map((row) => row.id).filter((id): id is string => typeof id === 'string');

    const present = await presentIds(database, target, ids);
    const missingIds = ids.filter((id) => !present.has(id));
    const [totals] = await database.select({ total: count() }).from(target);
    const { compared, mismatches } = await compareSample(database, target, rows, sampleSize);

    const report: VerifyReport = {
      table,
      sourceRows: rows.length,
      // Reported for context, never asserted equal: `images` will legitimately
      // hold more once the property batch lands, and "every source row is
      // present" is the stronger question anyway.
      targetRows: totals?.total ?? 0,
      missing: missingIds.length,
      missingIds: missingIds.slice(0, MAX_REPORTED_IDS),
      compared,
      mismatchCount: mismatches.length,
      mismatches: mismatches.slice(0, MAX_REPORTED_IDS),
    };
    logger.info(`Verified ${table}`, report);
    reports.push(report);
  }
  return reports;
}

// ── the run ────────────────────────────────────────────────────────

/**
 * Read, audit, copy and verify — on connections the caller already opened and
 * already checked.
 *
 * Exported so the test suite drives the SAME function production does, against a
 * real Mongo and a real Postgres, rather than a re-assembled imitation of it.
 * The two database-name guards are deliberately NOT in here: they belong to
 * whoever opened the connections, and {@link main} runs both before calling
 * this. A test's throwaway database has no such names to check.
 *
 * @throws {Error} When the audit refuses any row (nothing is written), or when
 *   verification finds a source row missing from the target or a column whose
 *   stored value differs from what the mappers produced.
 */
export async function runGeoBackfill(options: {
  readonly mongo: MongoDatabase;
  readonly database: Database;
  readonly mode: Mode;
  readonly sampleSize?: number;
}): Promise<GeoBackfillReport> {
  const { mongo, database, mode } = options;
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_ROWS;

  const planned = buildRows(await loadSource(mongo));
  const read = Object.fromEntries(
    GEO_COPY_ORDER.map((table) => [table, planned.rows[table].length]),
  ) as Record<GeoTableName, number>;
  logger.info('Source read', { ...read, resolutions: planned.resolutions });

  if (mode !== 'verify-only') {
    const violations = auditPlan(planned);
    if (violations.length > 0) {
      for (const line of violations) logger.error(line);
      throw new Error(
        `Audit refused ${violations.length} constraint violation(s); nothing was written. ` +
        'Every line above names a column, the reason the target would refuse it, ' +
        'how many rows carry it and example ids.',
      );
    }
    logger.info('Audit passed: every candidate row fits the target');
  }

  if (mode === 'audit-only') {
    logger.info('Audit-only run complete; nothing was written');
    return {
      mode,
      read,
      resolutions: planned.resolutions,
      copied: [],
      reconciled: [],
      verified: [],
    };
  }

  const writes = mode === 'copy' || mode === 'reconcile';
  const copied = writes ? await copyPlan(database, planned) : [];
  const reconciled = mode === 'reconcile' ? await reconcilePlan(database, planned) : [];

  const verified = await verifyPlan(database, planned, sampleSize);
  const failures = verified.filter((report) => report.missing > 0 || report.mismatchCount > 0);
  if (failures.length > 0) {
    throw new Error(
      `Verification failed for ${failures.map((report) => report.table).join(', ')}. ` +
      'See the per-table reports above: `missing` counts source rows with no ' +
      'target row, `mismatchCount` counts columns whose stored value differs ' +
      'from what the mappers produced. `--reconcile` brings existing rows back ' +
      'into line; the plain copy only ever inserts.',
    );
  }

  return { mode, read, resolutions: planned.resolutions, copied, reconciled, verified };
}

// ── entrypoint ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Argument validation first, before either connection string is read and
  // before anything opens a socket: an operator who forgot a flag should learn
  // it instantly rather than after two connection attempts.
  const argv = process.argv.slice(2);
  const target = readTargetDatabase(argv);
  const source = readSourceDatabase(argv);
  const mode = readMode(argv);
  const sampleSize = readSampleSize(argv);

  const mongoUrl = process.env.MONGODB_URI;
  if (!mongoUrl) throw new Error('MONGODB_URI is not set; there is nothing to copy from.');
  const postgresUrl = process.env.DATABASE_URL;
  if (!postgresUrl) throw new Error('DATABASE_URL is not set; there is nowhere to copy to.');

  logger.info('Geo backfill starting', { source, target, mode, sampleSize });

  await mongoose.connect(mongoUrl);
  const client = postgres(postgresUrl, { max: 1 });
  try {
    const mongo = mongoose.connection.db;
    if (!mongo) throw new Error('Mongo connected but published no database handle.');

    // Both guards before anything is read and long before anything is written.
    await assertMigrationSource(mongo, source);
    await assertMigrationTarget(client, target);

    const database = drizzle(client, { schema, casing: DATABASE_CASING });
    await runGeoBackfill({ mongo, database, mode, sampleSize });
    logger.info('Geo backfill complete', { source, target, mode });
  } finally {
    await client.end({ timeout: CLOSE_TIMEOUT_SECONDS });
    await mongoose.disconnect();
  }
}

// `require.main === module` rather than an unconditional call: this file is both
// a CLI entrypoint and a module the tests import for its exported guards.
if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('Geo backfill failed', error);
    // Not `process.exit`: it would truncate the very message that says what went
    // wrong. The event loop is free once both connections are closed.
    process.exitCode = 1;
  });
}
