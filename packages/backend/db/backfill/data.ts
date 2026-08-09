/**
 * Copy the rest of the data — images, addresses, agencies, properties and
 * profiles — from Mongo to Postgres.
 *
 * The second of two one-shots, run exactly like `db/migrate.ts` and compiled
 * into the same image (`dist/db/backfill/data.js`). The runtime image has no
 * ts-node, so a script that is not compiled cannot be run in production at all;
 * `db/` is what `tsconfig.build.json` emits and `scripts/` is deliberately
 * excluded from it.
 *
 *   node packages/backend/dist/db/backfill/data.js \
 *     --source-database=homiio-production --target-database=homiio
 *
 *   …--audit-only     measure every row against the target, write nothing
 *   …--verify-only    compare an already-copied target against the source
 *   …--sample=<n>     rows per table in the field-by-field comparison (default 200)
 *   …--only=a,b       a subset of collections (see the warning it prints)
 *
 * ## What it adds to `geo.ts`, and why it is a separate file
 *
 * `geo.ts` loads all five geo collections into memory before mapping any of
 * them, which is right for under eight thousand documents and impossible for
 * 171,976 images and 17,644 properties with their embedded arrays. So this
 * STREAMS, and everything that follows is a consequence of that:
 *
 *  - **Two passes in `copy` mode.** The audit reads the whole source and writes
 *    nothing; only then does the copy read it again and insert. That keeps the
 *    property `geo.ts` advertises — *it never runs an insert the audit has not
 *    seen* — which a single streaming pass cannot: it would refuse at the first
 *    bad batch with every earlier batch already committed.
 *  - **`RowAuditor` rather than `auditRows`.** Auditing per batch with the
 *    one-shot function would produce one grouped report per batch, three hundred
 *    of them, each saying "1 row". The grouping is what makes a report readable.
 *  - **Foreign keys resolved against BOTH stores.** `geo.ts` checks a reference
 *    against the ids its own run will insert, which works when every row is in
 *    memory. Here a parent may be in Postgres already (the geo rows) or about to
 *    be written by this run (`properties.address_id`), so the question asked is
 *    the one `23503` will actually answer: does this id exist in the target
 *    table, or in the source collection this run copies from?
 *
 * ## Two things happen only AFTER the copy, and both would be wrong before it
 *
 * `properties.has_images` is re-derived from `property_images` by
 * `db/hasImages.ts`, the column's one writer — deriving it against a half-loaded
 * child table would set every listing to `false`, which is not a visible failure
 * but a feed that quietly ranks everything the same. And the geo cover images
 * are filled in, because `cities.cover_image_id` could not be written while
 * `images` was empty.
 *
 * ## Idempotent, so a re-run converges
 *
 * Every insert is `ON CONFLICT DO NOTHING` over ids copied verbatim from Mongo.
 * A run that dies at document 90,000 is a position, not a mess. What makes that
 * safe rather than lossy is the verify step, which asks whether every source row
 * is PRESENT rather than trusting an insert count — `DO NOTHING` with no
 * conflict target also absorbs a unique-index collision, which is why the audit
 * checks for those separately.
 */

import mongoose from 'mongoose';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, count, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { assertMigrationTarget, readTargetDatabase } from '@oxyhq/db/migrate';

import { Logger } from '../../utils/logger';
import { DATABASE_CASING } from '../casing';
import { findHasImagesDisagreements, syncAllHasImages } from '../hasImages';
import type { Database } from '../postgres';
import * as schema from '../schema';
import { cities, images, regions } from '../schema';
import { GEO_IMAGE_ENTITY_TYPES, ResolutionLog, type SourceDocument } from './geoPlan';
import {
  DATA_COPY_ORDER,
  DATA_PLANS,
  DATA_TABLES,
  type DataCollectionName,
  type DataCollectionPlan,
  type ReferenceSpec,
} from './dataPlan';
import { columnNames, foreignKeyRule } from './geoPlan';
import {
  describeViolations,
  RowAuditor,
  UniqueKeyAuditor,
  type AuditViolation,
  type CandidateRow,
} from './rowAudit';
import {
  assertMigrationSource,
  canonicalJson,
  DEFAULT_SAMPLE_ROWS,
  presentIds,
  readMode,
  readSampleSize,
  readSourceDatabase,
  sameValue,
  type MongoDatabase,
  type Mode,
} from './geo';

const logger = new Logger('DataBackfill');

/**
 * The collection shape id lookups are typed against.
 *
 * `_id` is the UNION of both stored shapes rather than the driver's default:
 * Homiio's ids are permanently two-shaped, so `find({ _id: { $in: [...] } })`
 * with a mix of ObjectIds and uuid v7 strings does not compile against an
 * untyped collection handle.
 */
interface IdentifiedDocument {
  _id: mongoose.Types.ObjectId | string;
  [field: string]: unknown;
}

/** Seconds to wait for in-flight queries before forcing the socket shut. */
const CLOSE_TIMEOUT_SECONDS = 5;

/** Documents fetched per network round trip while streaming. */
const CURSOR_BATCH_SIZE = 500;

/** Rows per multi-row `INSERT`, before the per-table column count narrows it. */
const INSERT_BATCH_ROWS = 500;

/**
 * Bind parameters allowed in one statement.
 *
 * Postgres accepts 65,535; 50,000 leaves headroom that costs a few extra round
 * trips on a run measured in minutes. It matters because `properties` has 135
 * columns — a fixed batch of 500 rows there would be 67,500 parameters and a
 * hard protocol error, on the largest table, after the smaller ones had already
 * succeeded.
 */
const MAX_BIND_PARAMETERS = 50_000;

/** Ids resolved per `$in` when checking a foreign key's parents in Mongo. */
const MONGO_LOOKUP_BATCH = 1_000;

/** How often a streaming pass reports progress, in source documents. */
const PROGRESS_INTERVAL = 25_000;

/** Ids listed in a report when something is missing. Enough to grep for. */
const MAX_REPORTED_IDS = 5;

/**
 * How far an address may sit from its own city's centroid before it is
 * reported.
 *
 * 300 km is generous for a centroid and nowhere near a transposition: swapping
 * Barcelona's pair (2.1686, 41.3985) lands the point off Somalia, ~5,000 km
 * away. Loose on purpose — a check that cries wolf on a coarse centroid is a
 * check somebody switches off.
 */
const CITY_CENTROID_LIMIT_METRES = 300_000;

/**
 * The share of addresses that may sit outside {@link CITY_CENTROID_LIMIT_METRES}
 * before the run is refused.
 *
 * The check exists to catch a TRANSPOSED coordinate pair, and a transposition is
 * a property of the MAPPER — so it moves every address, not a handful. Measured
 * against production: 2 of 11,734 (0.017%) are outside 300 km, and both are bad
 * geocodes in Mongo that the copy reproduced faithfully — an address on
 * `León Capital` at (-66.99, 10.53), which is Caracas, and a Bremen address at
 * (0, 0). Neither is a transposition: swapping either pair gives something else
 * again, and the field-by-field check confirms both match the source exactly.
 *
 * A gate at "zero outliers" therefore fails forever on data the copy did not
 * create, and a gate that fails forever is one somebody switches off. 1% is two
 * orders of magnitude above the observed rate and two below a transposition,
 * which would put ~100% over the line. Every outlier is REPORTED either way —
 * the rate decides whether the run is refused, never whether an operator is
 * told.
 */
const CITY_CENTROID_OUTLIER_LIMIT = 0.01;

/** How far a measured city-pair distance may sit from the real-world figure. */
const CITY_PAIR_TOLERANCE = 0.25;

/**
 * Real-world distances between city centres, for the named half of the geometry
 * check.
 *
 * The addresses are anywhere within their cities, so this is not measuring town
 * hall to town hall — ±25% distinguishes "these are the right two cities" from
 * "one of them is in the wrong hemisphere", which is the only question a
 * transposition check has to answer.
 */
const CITY_PAIRS = [
  { from: 'Barcelona', to: 'Madrid', metres: 505_000 },
  { from: 'Barcelona', to: 'Paris', metres: 830_000 },
] as const;

/** Per-collection outcome of the copy. */
export interface CopyReport {
  readonly collection: DataCollectionName;
  readonly documents: number;
  readonly inserted: Readonly<Record<string, number>>;
}

/** Per-table outcome of the verification. */
export interface VerifyReport {
  readonly table: string;
  readonly sourceDocuments: number;
  readonly targetRows: number;
  readonly missing: number;
  readonly missingIds: readonly string[];
  readonly compared: number;
  readonly mismatches: readonly string[];
}

/** What the geometry checks measured. */
export interface GeometryReport {
  readonly centroidSamples: number;
  readonly centroidMaxMetres: number | null;
  readonly centroidOverLimit: number;
  readonly pairs: readonly {
    readonly from: string;
    readonly to: string;
    readonly expectedMetres: number;
    readonly measuredMetres: number | null;
    readonly withinTolerance: boolean | null;
  }[];
}

/** What the cover-image step did, per geo level. */
export interface CoverReport {
  readonly table: 'cities' | 'regions';
  readonly claimed: number;
  readonly linked: number;
  readonly alreadySet: number;
  readonly unresolvable: number;
  readonly notAGeoImage: number;
}

/** What one run did, whichever mode it ran in. */
export interface DataBackfillReport {
  readonly mode: Mode;
  readonly resolutions: Readonly<Record<string, number>>;
  readonly audited: Readonly<Record<string, number>>;
  readonly copied: readonly CopyReport[];
  readonly hasImagesRederived: number | null;
  readonly covers: readonly CoverReport[];
  readonly verified: readonly VerifyReport[];
  readonly geometry: GeometryReport | null;
  readonly hasImagesDisagreements: number | null;
}

// ── the streaming pass ─────────────────────────────────────────────

/** A buffered, batched, `ON CONFLICT DO NOTHING` writer for one table. */
interface TableWriter {
  push(row: CandidateRow): void;
  /** Write whatever is buffered. */
  flush(): Promise<void>;
  /**
   * Whether this table's buffer has reached its own batch size.
   *
   * ASKED rather than acted on, because the flush decision belongs to the plan:
   * one full child means every table flushes, parent first. See the call site.
   */
  readonly isFull: boolean;
  readonly inserted: number;
}

/**
 * Rows per statement for a table, derived from its column count.
 *
 * Derived rather than chosen so that a table added later cannot reintroduce the
 * parameter-limit failure, and so no per-table tuning table has to be kept
 * correct.
 */
function batchRows(table: PgTable): number {
  const columns = Object.keys(getTableColumns(table)).length;
  return Math.max(1, Math.min(INSERT_BATCH_ROWS, Math.floor(MAX_BIND_PARAMETERS / columns)));
}

function createWriter(database: Database, table: PgTable, write: boolean): TableWriter {
  const limit = batchRows(table);
  const buffer: CandidateRow[] = [];
  let inserted = 0;

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    if (!write) return;
    // The rows arrive loosely typed because the AUDIT is what proves their
    // shape — it reads the target's own column metadata, so a row that survives
    // it is one Postgres accepts. This narrowing is that proof cashed in, and it
    // is the same one `geo.ts` makes for the same reason.
    await database
      .insert(table)
      .values(batch as PgTable['$inferInsert'][])
      .onConflictDoNothing();
    inserted += batch.length;
  };

  return {
    push(row) {
      buffer.push(row);
    },
    async flush() {
      await flush();
    },
    get isFull() {
      return buffer.length >= limit;
    },
    get inserted() {
      return inserted;
    },
  };
}

/** Every document in a collection, in `_id` order, streamed. */
async function* streamCollection(
  mongo: MongoDatabase,
  collection: string,
): AsyncIterable<SourceDocument> {
  const cursor = mongo
    .collection(collection)
    .find({}, { batchSize: CURSOR_BATCH_SIZE, sort: { _id: 1 } });
  try {
    for await (const document of cursor) yield document as SourceDocument;
  } finally {
    await cursor.close();
  }
}

/** What one streaming pass over one collection produced. */
interface PassResult {
  readonly documents: number;
  readonly inserted: Readonly<Record<string, number>>;
  readonly violations: readonly AuditViolation[];
  /** Rows audited per table — the vacuity floor for an empty violation list. */
  readonly audited: Readonly<Record<string, number>>;
}

/**
 * Stream one collection: map every document, audit every row it produces, and —
 * when `write` is set — insert them in batches.
 *
 * The audit runs in BOTH modes and on every row. In `audit` mode the writers
 * simply do not write, so the rows the audit inspects are, batch for batch, the
 * rows the copy would have inserted. An audit built from a separate "check the
 * document" pass could pass on a document whose MAPPER produces something else,
 * which is the failure mode that makes a pre-flight check worth less than none.
 */
async function streamCollectionPass(
  database: Database,
  mongo: MongoDatabase,
  plan: DataCollectionPlan,
  log: ResolutionLog,
  write: boolean,
): Promise<PassResult> {
  const writers = new Map<string, TableWriter>();
  const auditors = new Map<string, RowAuditor>();
  const referenced = new Map<ReferenceSpec, Set<string>>();
  const uniqueAuditors = plan.uniqueKeys.map((spec) => ({
    spec,
    auditor: new UniqueKeyAuditor(spec.constraint, spec.key),
  }));

  for (const table of plan.tables) {
    const target = requireTable(table);
    writers.set(table, createWriter(database, target, write));
    auditors.set(table, new RowAuditor(target, plan.rules[table] ?? []));
  }
  for (const spec of plan.references) referenced.set(spec, new Set<string>());

  let documents = 0;
  for await (const document of streamCollection(mongo, plan.sourceCollection)) {
    const mapped = plan.map(document, log);

    for (const table of plan.tables) {
      const rows = mapped[table] ?? [];
      if (rows.length === 0) continue;
      auditors.get(table)?.add(rows);
      for (const entry of uniqueAuditors) {
        if (entry.spec.table === table) entry.auditor.add(rows);
      }
      for (const spec of plan.references) {
        if (spec.table !== table) continue;
        const collected = referenced.get(spec);
        if (collected === undefined) continue;
        for (const row of rows) {
          const value = row[spec.column];
          if (typeof value === 'string') collected.add(value);
        }
      }
      const writer = writers.get(table);
      if (writer) for (const row of rows) writer.push(row);
    }

    // ALL OR NONE, parent first — never "each table when its own buffer fills".
    //
    // A child's foreign key is `NOT NULL`, so a `property_images` batch that
    // reaches the server before the `properties` rows it references is a
    // `23503`. Per-table thresholds guarantee exactly that: `properties` is 135
    // columns wide and fills at 370 rows, `property_images` is 11 columns wide
    // and fills at 500 — and each property carries about ten photos, so the
    // CHILD fills after roughly fifty documents while the parent is still four
    // fifths empty.
    //
    // Measured, not reasoned: the first production copy died here, on the first
    // `property_images` batch, with `images`, `addresses` and `agencies` already
    // written. No test caught it because no fixture had ever crossed a batch
    // boundary — 50 properties is enough, and `writes a child batch only after
    // its parents` is now that fixture.
    if (plan.tables.some((table) => writers.get(table)?.isFull === true)) {
      for (const table of plan.tables) await writers.get(table)?.flush();
    }

    documents += 1;
    if (documents % PROGRESS_INTERVAL === 0) {
      logger.info(`${plan.name}: ${documents} documents`, {
        inserted: insertedCounts(plan, writers),
      });
    }
  }

  for (const table of plan.tables) await writers.get(table)?.flush();

  const violations: AuditViolation[] = [];
  const audited: Record<string, number> = {};
  for (const table of plan.tables) {
    const auditor = auditors.get(table);
    if (auditor === undefined) continue;
    audited[table] = auditor.audited;
    violations.push(...auditor.drain());
  }
  for (const entry of uniqueAuditors) violations.push(...entry.auditor.drain());

  // Once per collection rather than per document: the question is SET membership
  // over hundreds of thousands of ids, and asking it one id at a time is the
  // difference between seconds and hours.
  violations.push(...(await resolveReferences(database, mongo, plan, referenced)));

  return { documents, inserted: insertedCounts(plan, writers), violations, audited };
}

function insertedCounts(
  plan: DataCollectionPlan,
  writers: ReadonlyMap<string, TableWriter>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of plan.tables) counts[table] = writers.get(table)?.inserted ?? 0;
  return counts;
}

/**
 * Resolve every collected foreign key against BOTH stores.
 *
 * A parent may legitimately live in either: `addresses.city_id` points at geo
 * rows already in Postgres, `properties.address_id` at rows this very run is
 * about to write. Checking only Postgres would report every property as an
 * orphan; checking only Mongo would miss a geo row that never arrived. The union
 * is the only question worth asking — "will this reference resolve by the time
 * the row is inserted?"
 */
async function resolveReferences(
  database: Database,
  mongo: MongoDatabase,
  plan: DataCollectionPlan,
  referenced: ReadonlyMap<ReferenceSpec, ReadonlySet<string>>,
): Promise<AuditViolation[]> {
  const violations: AuditViolation[] = [];

  for (const [spec, ids] of referenced) {
    if (ids.size === 0) continue;
    const wanted = [...ids];

    const inTarget = await presentIds(database, requireTable(spec.parentTable), wanted);
    const stillMissing = wanted.filter((id) => !inTarget.has(id));
    const resolvable = new Set(inTarget);

    if (stillMissing.length > 0 && spec.parentCollection !== null) {
      for (const id of await presentInMongo(mongo, spec.parentCollection, stillMissing)) {
        resolvable.add(id);
      }
    }

    // Re-checked through the SAME rule the geo copy uses, so a dangling
    // reference is reported in one vocabulary across both halves of the
    // migration rather than two.
    const rule = foreignKeyRule(spec.constraint, spec.column, resolvable, spec.nullable);
    const offenders = wanted.filter((id) => !resolvable.has(id));
    if (offenders.length === 0) continue;

    violations.push({
      column: rule.name,
      reason: `${rule.reason} — no ${spec.parentTable} row and no ${spec.parentCollection ?? '(no source collection)'} document holds it`,
      rows: offenders.length,
      examples: offenders.slice(0, MAX_REPORTED_IDS).map((id) => ({ id: plan.name, value: id })),
    });
  }

  return violations;
}

/** Which of these ids the source collection holds. Batched — see the audit's cost. */
async function presentInMongo(
  mongo: MongoDatabase,
  collection: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  const present = new Set<string>();
  for (let start = 0; start < ids.length; start += MONGO_LOOKUP_BATCH) {
    const batch = ids.slice(start, start + MONGO_LOOKUP_BATCH);
    // Both id shapes are live and permanently so (24-char ObjectId hex before
    // the cutover, uuid v7 after), and `isValid` decides only the SPELLING of
    // the lookup — never whether an id is acceptable. The collection is typed
    // through `IdentifiedDocument` so the union is expressible; the untyped
    // handle assumes `ObjectId` and would not compile.
    const keys = batch.map((id) =>
      mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id,
    );
    const found = await mongo
      .collection<IdentifiedDocument>(collection)
      .find({ _id: { $in: keys } }, { projection: { _id: 1 } })
      .toArray();
    for (const document of found) present.add(String(document._id));
  }
  return present;
}

// ── after the copy ─────────────────────────────────────────────────

/**
 * Fill `cities.cover_image_id` / `regions.cover_image_id` where they are NULL.
 *
 * The geo copy could only link a cover whose image it CARRIED (`city`, `region`
 * and `country` photos), and it wrote NULL for anything else rather than fail a
 * real foreign key. Now that every image exists, the remainder can be filled.
 *
 * Three rules, and each is a decision rather than a mechanism:
 *
 *  - **Only NULL covers are touched.** A cover the application has since set for
 *    itself (`cityCoverSyncService` writes this column at runtime) is left
 *    exactly as it is — a backfill that reverted live work would be a copy
 *    fighting the system it is copying into. It is also what makes a re-run a
 *    no-op.
 *  - **A cover naming a PROPERTY photo is refused, not linked.** The foreign key
 *    would accept it and the result would be a listing's photo on a city, which
 *    `db/MIGRATION-CONTRACT.md` records as wrong by construction — it is the bug
 *    `cityCoverSyncService.forceReplaceListingCovers` exists to undo.
 *  - **`updated_at` is assigned FROM ITSELF.** This is the only UPDATE in the
 *    whole backfill, and drizzle applies `$onUpdate` to any column not named in
 *    `.set()` — so the obvious spelling would restamp every row with the
 *    backfill's own clock and destroy the historical value. In an `UPDATE … SET`
 *    the right-hand side reads the OLD row, so this is an explicit no-op that
 *    displaces the automatic one.
 */
export async function linkCoverImages(
  database: Database,
  mongo: MongoDatabase,
): Promise<CoverReport[]> {
  const reports: CoverReport[] = [];
  for (const level of [
    { table: 'cities' as const, collection: 'cities', target: cities },
    { table: 'regions' as const, collection: 'regions', target: regions },
  ]) {
    const claims = new Map<string, string>();
    for await (const document of streamCollection(mongo, level.collection)) {
      const id = String(document._id);
      const cover = document.coverImageId;
      if (cover === undefined || cover === null) continue;
      claims.set(id, String(cover));
    }

    // One query for every referenced cover, with its entity type, rather than a
    // lookup per row: 1,230 covers over 1,660 cities.
    const wanted = [...new Set(claims.values())];
    const geoImages = new Set<string>();
    const anyImage = new Set<string>();
    for (let start = 0; start < wanted.length; start += MONGO_LOOKUP_BATCH) {
      const batch = wanted.slice(start, start + MONGO_LOOKUP_BATCH);
      const rows = await database
        .select({ id: images.id, entityType: images.entityType })
        .from(images)
        .where(inArray(images.id, batch));
      for (const row of rows) {
        anyImage.add(row.id);
        if ((GEO_IMAGE_ENTITY_TYPES as readonly string[]).includes(row.entityType)) {
          geoImages.add(row.id);
        }
      }
    }

    let linked = 0;
    let alreadySet = 0;
    let unresolvable = 0;
    let notAGeoImage = 0;
    for (const [rowId, coverId] of claims) {
      if (!anyImage.has(coverId)) {
        unresolvable += 1;
        continue;
      }
      if (!geoImages.has(coverId)) {
        notAGeoImage += 1;
        continue;
      }
      const updated = await database
        .update(level.target)
        .set({ coverImageId: coverId, updatedAt: sql`${level.target.updatedAt}` })
        .where(and(eq(level.target.id, rowId), isNull(level.target.coverImageId)))
        .returning({ id: level.target.id });
      if (updated.length > 0) linked += 1;
      else alreadySet += 1;
    }

    const report: CoverReport = {
      table: level.table,
      claimed: claims.size,
      linked,
      alreadySet,
      unresolvable,
      notAGeoImage,
    };
    logger.info(`Cover images for ${level.table}`, report);
    reports.push(report);
  }
  return reports;
}

// ── verifying ──────────────────────────────────────────────────────

/**
 * Counts, completeness by ID, and a field-by-field sample — per collection.
 *
 * Completeness is by ID rather than by count because equal counts can hide a
 * copy that dropped forty rows and gained forty others: `ON CONFLICT DO NOTHING`
 * absorbing a unique collision while the ingestion worker inserted new listings
 * is exactly that shape, and a count comparison reports it as perfect.
 *
 * Fidelity RE-RUNS the mapper against the live source document. Reading back
 * what was written and checking it is what was written is a check that cannot
 * fail.
 */
async function verifyCollection(
  database: Database,
  mongo: MongoDatabase,
  plan: DataCollectionPlan,
  sampleSize: number,
): Promise<VerifyReport[]> {
  const parentTable = plan.tables[0];
  const target = requireTable(parentTable);

  const ids: string[] = [];
  let missing = 0;
  const missingIds: string[] = [];
  let pending: string[] = [];

  const drain = async (): Promise<void> => {
    if (pending.length === 0) return;
    const present = await presentIds(database, target, pending);
    for (const id of pending) {
      if (present.has(id)) continue;
      missing += 1;
      if (missingIds.length < MAX_REPORTED_IDS) missingIds.push(id);
    }
    pending = [];
  };

  for await (const document of streamCollection(mongo, plan.sourceCollection)) {
    const id = String(document._id);
    ids.push(id);
    pending.push(id);
    if (pending.length >= MONGO_LOOKUP_BATCH) await drain();
  }
  await drain();

  const [totals] = await database.select({ total: count() }).from(target);
  const { compared, mismatches } = await compareSample(database, mongo, plan, sampleSize);

  const report: VerifyReport = {
    table: parentTable,
    sourceDocuments: ids.length,
    targetRows: totals?.total ?? 0,
    missing,
    missingIds,
    compared,
    mismatches: mismatches.slice(0, MAX_REPORTED_IDS),
  };
  logger.info(`Verified ${plan.name}`, report);
  return [report];
}

/**
 * Re-map a sample of source documents and compare every column against what is
 * stored.
 *
 * `$sample` rather than the first N: `_id` order is creation order, so the front
 * of `properties` is its OLDEST rows — the cohort least likely to carry the
 * sub-objects added later, which are exactly the fields a fidelity check most
 * needs to exercise.
 *
 * A column the mapper left `undefined` is SKIPPED only where the column has a
 * default; where it has none, `undefined` must have stored NULL and that IS
 * checked — the difference between "the schema filled this in" and "the copy
 * lost it".
 */
async function compareSample(
  database: Database,
  mongo: MongoDatabase,
  plan: DataCollectionPlan,
  sampleSize: number,
): Promise<{ compared: number; mismatches: string[] }> {
  const documents = (await mongo
    .collection(plan.sourceCollection)
    .aggregate([{ $sample: { size: sampleSize } }])
    .toArray()) as SourceDocument[];

  const log = new ResolutionLog();
  const mismatches: string[] = [];
  let compared = 0;

  for (const document of documents) {
    const mapped = plan.map(document, log);
    for (const table of plan.tables) {
      const rows = mapped[table] ?? [];
      if (rows.length === 0) continue;
      const target = requireTable(table);
      const columns = getTableColumns(target);

      if (plan.mintsIds.includes(table)) {
        compared += rows.length;
        mismatches.push(...(await compareMintedRows(database, plan, table, rows)));
        continue;
      }

      const rowIds = rows.map((row) => String(row.id));
      const stored = await database
        .select()
        .from(target)
        .where(inArray(getTableColumns(target).id, rowIds));
      const byId = new Map(
        stored.map((row) => [String((row as CandidateRow).id), row as CandidateRow]),
      );

      for (const expected of rows) {
        compared += 1;
        const actual = byId.get(String(expected.id));
        if (actual === undefined) {
          mismatches.push(`${table}/${String(expected.id)}: absent from the target`);
          continue;
        }
        for (const column of columnNames(target)) {
          // GENERATED ALWAYS columns are not the copy's to produce — `geo`,
          // `address_level` and `search_vector` are derived by the DATABASE from
          // columns that were copied, and writing one raises 428C9. Comparing
          // them would report a mismatch on every row of a perfect copy.
          if (columns[column]?.generated !== undefined) continue;
          const want = expected[column];
          // `undefined` means the mapper omitted the key, so the column's own
          // DEFAULT decided the stored value and there is nothing to compare it
          // against. Where there is no default, NULL is the only legal outcome
          // and it is checked.
          if (want === undefined) {
            if (columns[column]?.hasDefault) continue;
            if (actual[column] === null) continue;
            mismatches.push(
              `${table}/${String(expected.id)}.${column}: expected NULL, stored ${JSON.stringify(actual[column])}`,
            );
            continue;
          }
          if (!sameValue(want, actual[column])) {
            mismatches.push(
              `${table}/${String(expected.id)}.${column}: expected ${JSON.stringify(want)}, stored ${JSON.stringify(actual[column])}`,
            );
          }
        }
      }
    }
  }

  return { compared, mismatches };
}

/**
 * Compare rows whose ids were MINTED, as a set, with the id excluded.
 *
 * A re-map mints new ids, so there is nothing to match on — and nothing to
 * check either: the id is the one value the copy invented rather than carried.
 * Everything else IS checked, against every stored row for the same parent, so a
 * lost field or a wrong one still fails.
 *
 * Matching by parent rather than globally keeps the comparison meaningful on a
 * table that will hold millions of rows.
 */
async function compareMintedRows(
  database: Database,
  plan: DataCollectionPlan,
  table: string,
  rows: readonly CandidateRow[],
): Promise<string[]> {
  const target = requireTable(table);
  const columns = getTableColumns(target);
  const parentColumn = plan.references.find((spec) => spec.table === table)?.column;
  if (parentColumn === undefined || rows.length === 0) return [];

  const parents = [...new Set(rows.map((row) => String(row[parentColumn])))];
  const stored = await database
    .select()
    .from(target)
    .where(inArray(columns[parentColumn], parents));

  const fingerprint = (row: CandidateRow): string =>
    canonicalJson(
      Object.fromEntries(
        Object.keys(columns)
          .filter((column) => column !== 'id' && columns[column]?.generated === undefined)
          .map((column) => [column, row[column] ?? null]),
      ),
    );

  const available = new Map<string, number>();
  for (const row of stored) {
    const key = fingerprint(row as CandidateRow);
    available.set(key, (available.get(key) ?? 0) + 1);
  }

  const mismatches: string[] = [];
  for (const expected of rows) {
    const key = fingerprint(expected);
    const remaining = available.get(key) ?? 0;
    if (remaining === 0) {
      mismatches.push(`${table}: no stored row matches ${key}`);
      continue;
    }
    available.set(key, remaining - 1);
  }
  return mismatches;
}

/**
 * The geometry checks — the only ones that can see a transposed coordinate pair.
 *
 * `addresses.geo` is GENERATED from `longitude`/`latitude`, so it is never null
 * and never disagrees with its columns. That makes "the column is populated" a
 * check which passes just as happily on a pair swapped end for end: the result
 * is a valid point in the wrong hemisphere, indexable, queryable, and wrong.
 * Only a DISTANCE can tell.
 *
 * Both halves are needed. The centroid sweep covers EVERY address and catches a
 * transposition anywhere in the table; the named pairs are an independent
 * real-world anchor that would catch an error the sweep cannot see, because both
 * sides of the sweep's comparison come from the same migration.
 */
export async function checkGeometry(database: Database): Promise<GeometryReport> {
  const [centroid] = await database.execute<{
    samples: string;
    max_metres: number | null;
    over_limit: string;
  }>(sql`
    select
      count(*)::text as samples,
      max(distance) as max_metres,
      count(*) filter (where distance > ${CITY_CENTROID_LIMIT_METRES})::text as over_limit
    from (
      select ST_Distance(a.geo, ST_MakePoint(c.longitude, c.latitude)::geography) as distance
      from addresses a
      join cities c on c.id = a.city_id
      where c.longitude is not null and c.latitude is not null
    ) measured
  `);

  const pairs: GeometryReport['pairs'][number][] = [];
  for (const pair of CITY_PAIRS) {
    const [row] = await database.execute<{ metres: number | null }>(sql`
      select ST_Distance(
        (select a.geo from addresses a join cities c on c.id = a.city_id
          where lower(c.name) = lower(${pair.from}) limit 1),
        (select a.geo from addresses a join cities c on c.id = a.city_id
          where lower(c.name) = lower(${pair.to}) limit 1)
      ) as metres
    `);
    const measuredMetres = row?.metres ?? null;
    pairs.push({
      from: pair.from,
      to: pair.to,
      expectedMetres: pair.metres,
      measuredMetres,
      // `null` rather than `false` when a city has no address: "nothing in
      // Paris" is not a failed distance check, and reporting it as one would
      // make an honest gap indistinguishable from a transposition. The CALLER
      // decides what to do with it — and treats it as not-passed, so an absent
      // city can never be read as a pass either.
      withinTolerance:
        measuredMetres === null
          ? null
          : Math.abs(measuredMetres - pair.metres) <= pair.metres * CITY_PAIR_TOLERANCE,
    });
  }

  return {
    centroidSamples: Number(centroid?.samples ?? 0),
    centroidMaxMetres: centroid?.max_metres ?? null,
    centroidOverLimit: Number(centroid?.over_limit ?? 0),
    pairs,
  };
}

// ── the run ────────────────────────────────────────────────────────

/**
 * Audit, copy and verify — on connections the caller already opened and already
 * checked.
 *
 * Exported so the test suite drives the SAME function production does, against a
 * real Mongo and a real Postgres, rather than a re-assembled imitation of it.
 * The two database-name guards are deliberately NOT in here: they belong to
 * whoever opened the connections, and {@link main} runs both before calling
 * this. A test's throwaway database has no such names to check.
 *
 * @throws {Error} When the audit refuses any row (nothing is written), or when
 *   verification finds a source row missing from the target, a column whose
 *   stored value differs from what the mappers produce, a `has_images`
 *   disagreement, or a geometry check that did not pass.
 */
export async function runDataBackfill(options: {
  readonly mongo: MongoDatabase;
  readonly database: Database;
  readonly mode: Mode;
  readonly sampleSize?: number;
  readonly only?: readonly DataCollectionName[];
}): Promise<DataBackfillReport> {
  const { mongo, database, mode } = options;
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_ROWS;
  const selected = options.only ?? DATA_COPY_ORDER;
  const plans = DATA_COPY_ORDER.filter((name) => selected.includes(name)).map(
    (name) => DATA_PLANS[name],
  );
  const partial = plans.length !== DATA_COPY_ORDER.length;

  // ONE LOG PER PASS, not one per run.
  //
  // `copy` mode reads the source twice — once to audit, once to write — and both
  // passes run the same mappers, so a shared log counts every resolution TWICE.
  // Measured against production: `MODERATION_ABSENT` reported 35,284 for a
  // collection of 17,644 rows. The reported figure is compared against a frozen
  // census count, so doubling it does not just look untidy, it makes the
  // comparison meaningless in the direction that reads as drift.
  //
  // The COPY pass's log is what the run reports, because it describes the rows
  // that were written; the audit pass's is logged beside its own verdict.
  const auditLog = new ResolutionLog();
  const copyLog = new ResolutionLog();
  const audited: Record<string, number> = {};

  // ── the audit pass ──
  //
  // A full read that writes nothing, in BOTH `audit-only` and `copy` mode. The
  // second is the point: it is what keeps "never run an insert the audit has not
  // seen" true for a streaming copy, which a single pass cannot — it would
  // refuse at the first bad batch with every earlier batch already committed.
  if (mode !== 'verify-only') {
    const violations: AuditViolation[] = [];
    for (const plan of plans) {
      const pass = await streamCollectionPass(database, mongo, plan, auditLog, false);
      Object.assign(audited, pass.audited);
      violations.push(...pass.violations);
      logger.info(`Audited ${plan.name}`, { documents: pass.documents, rows: pass.audited });
    }

    if (violations.length > 0) {
      for (const line of describeViolations('audit', violations)) logger.error(line);
      throw new Error(
        `Audit refused ${violations.length} constraint violation(s); nothing was written. ` +
        'Every line above names a column, the reason the target would refuse it, ' +
        'how many rows carry it and example ids.',
      );
    }

    // The VACUITY FLOOR. "No violations" and "nothing was checked" are the same
    // report, and a streaming audit can produce the second one for a dozen
    // boring reasons. Refusing here is what stops an empty pass being read as a
    // clean one — the source guard already proved the collections exist, so zero
    // rows audited means something between them and here went wrong.
    const totalAudited = Object.values(audited).reduce((sum, rows) => sum + rows, 0);
    if (totalAudited === 0) {
      throw new Error(
        'The audit examined ZERO rows across every selected collection. That is ' +
        'not a clean audit — it is an audit that ran against nothing, and it ' +
        'reports identically to one that passed. Nothing was written.',
      );
    }
    logger.info('Audit passed', { rows: audited, resolutions: auditLog.toRecord() });
  }

  if (mode === 'audit-only') {
    return {
      mode,
      resolutions: auditLog.toRecord(),
      audited,
      copied: [],
      hasImagesRederived: null,
      covers: [],
      verified: [],
      geometry: null,
      hasImagesDisagreements: null,
    };
  }

  // ── the copy pass ──
  const copied: CopyReport[] = [];
  if (mode === 'copy') {
    for (const plan of plans) {
      const pass = await streamCollectionPass(database, mongo, plan, copyLog, true);
      const report: CopyReport = {
        collection: plan.name,
        documents: pass.documents,
        inserted: pass.inserted,
      };
      logger.info(`Copied ${plan.name}`, report);
      copied.push(report);
    }
  }

  // ── after the copy ──
  //
  // Both steps read tables a SCOPED run may not have populated, and running them
  // against a partial copy writes a wrong answer rather than no answer: deriving
  // `has_images` from a half-loaded `property_images` sets every listing to
  // `false`, and linking covers before `images` is loaded records every one of
  // them as unresolvable.
  let hasImagesRederived: number | null = null;
  let covers: CoverReport[] = [];
  if (mode === 'copy' && !partial) {
    hasImagesRederived = await syncAllHasImages(database);
    logger.info('properties.has_images re-derived from property_images', { hasImagesRederived });
    covers = await linkCoverImages(database, mongo);
  } else if (mode === 'copy') {
    logger.warn(
      'Scoped run (--only): has_images derivation and geo cover linking were SKIPPED. ' +
      'Both read tables this run may not have populated.',
    );
  }

  // ── verification ──
  const verified: VerifyReport[] = [];
  for (const plan of plans) {
    verified.push(...(await verifyCollection(database, mongo, plan, sampleSize)));
  }

  const geometry = selected.includes('addresses') ? await checkGeometry(database) : null;
  const hasImagesDisagreements = partial ? null : (await findHasImagesDisagreements(database)).length;

  logger.info('Verification measurements', {
    geometry,
    hasImagesDisagreements,
    resolutions: copyLog.toRecord(),
  });

  const failures: string[] = [];
  for (const report of verified) {
    if (report.missing > 0) {
      failures.push(`${report.table}: ${report.missing} source row(s) missing from the target`);
    }
    if (report.mismatches.length > 0) {
      failures.push(`${report.table}: ${report.mismatches.length} column(s) differ from the source`);
    }
    // The vacuity floor, and it has to be conditional: a collection that is
    // legitimately empty compares nothing and that is the correct answer. What
    // must never pass is a collection with documents whose sample compared none
    // of them — "no mismatches" and "nothing was compared" read identically.
    if (report.compared === 0 && report.sourceDocuments > 0) {
      failures.push(
        `${report.table}: ${report.sourceDocuments} source document(s) and the ` +
        'field-by-field sample compared NOTHING',
      );
    }
  }
  if (geometry !== null) {
    if (geometry.centroidSamples === 0) {
      failures.push('geometry: no address could be compared against its city centroid');
    }
    if (geometry.centroidOverLimit > 0) {
      const share = geometry.centroidOverLimit / Math.max(geometry.centroidSamples, 1);
      const line =
        `${geometry.centroidOverLimit} of ${geometry.centroidSamples} address(es) ` +
        `(${(share * 100).toFixed(3)}%) sit more than ` +
        `${CITY_CENTROID_LIMIT_METRES / 1000} km from their own city`;
      // Reported either way; the RATE decides whether the run is refused. See
      // CITY_CENTROID_OUTLIER_LIMIT — a transposition moves every address, a bad
      // geocode in the source moves one.
      if (share > CITY_CENTROID_OUTLIER_LIMIT) {
        failures.push(`geometry: ${line} — the shape a transposed pair makes`);
      } else {
        logger.warn(
          `geometry: ${line}. Below the ${CITY_CENTROID_OUTLIER_LIMIT * 100}% ` +
          'transposition threshold, so this reads as bad geocodes in the SOURCE ' +
          'rather than a copy that moved them — the field-by-field check compares ' +
          'each pair against the source document and would have failed otherwise.',
        );
      }
    }
    // A pair with no address in one of its cities was NOT MEASURED, which is not
    // the same as measured-and-wrong: reporting it as a failure would make an
    // honest gap indistinguishable from a transposition. What must not happen is
    // every pair going unmeasured and the check reporting a pass — so the
    // vacuity floor is that at least one real-world distance was obtained.
    const measured = geometry.pairs.filter((pair) => pair.measuredMetres !== null);
    if (measured.length === 0) {
      failures.push(
        'geometry: not one named city pair could be measured, so nothing anchored ' +
        `the coordinates to a real-world distance (tried ${geometry.pairs.map((pair) => `${pair.from}→${pair.to}`).join(', ')})`,
      );
    }
    for (const pair of measured) {
      if (pair.withinTolerance === true) continue;
      failures.push(
        `geometry: ${pair.from}→${pair.to} measured ${pair.measuredMetres} m ` +
        `against an expected ${pair.expectedMetres} m`,
      );
    }
  }
  if (hasImagesDisagreements !== null && hasImagesDisagreements > 0) {
    failures.push(
      `has_images: ${hasImagesDisagreements} listing(s) disagree with their own photo rows`,
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) logger.error(failure);
    throw new Error(`Verification failed:\n  ${failures.join('\n  ')}`);
  }

  return {
    mode,
    // The COPY pass's counts. In `verify-only` this log is the one
    // `compareSample` filled while re-running the mappers, which is the only
    // pass that ran.
    resolutions: copyLog.toRecord(),
    audited,
    copied,
    hasImagesRederived,
    covers,
    verified,
    geometry,
    hasImagesDisagreements,
  };
}

/**
 * The `--only=a,b` argument, or every collection.
 *
 * @throws {Error} When it names a collection that does not exist. A typo
 *   silently running nothing would be a successful-looking no-op, which is the
 *   failure this whole file is built against.
 */
export function readOnly(argv: readonly string[]): readonly DataCollectionName[] {
  const prefix = '--only=';
  const flag = argv.find((argument) => argument.startsWith(prefix));
  if (flag === undefined) return DATA_COPY_ORDER;

  const names = flag.slice(prefix.length).split(',').map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter(
    (name) => !(DATA_COPY_ORDER as readonly string[]).includes(name),
  );
  if (unknown.length > 0) {
    throw new Error(
      `--only names ${unknown.join(', ')}, which this backfill does not know. ` +
      `Valid names: ${DATA_COPY_ORDER.join(', ')}.`,
    );
  }
  return names as readonly DataCollectionName[];
}

/** The drizzle table a SQL name refers to. */
function requireTable(name: string): PgTable {
  const table = DATA_TABLES[name];
  if (table === undefined) {
    throw new Error(
      `No table named ${JSON.stringify(name)} is registered in DATA_TABLES. Refusing ` +
      'rather than skipping it: a pass that cannot find its table audits nothing ' +
      'and reports success exactly as loudly as one that passed.',
    );
  }
  return table;
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
  const only = readOnly(argv);

  const mongoUrl = process.env.MONGODB_URI;
  if (!mongoUrl) throw new Error('MONGODB_URI is not set; there is nothing to copy from.');
  const postgresUrl = process.env.DATABASE_URL;
  if (!postgresUrl) throw new Error('DATABASE_URL is not set; there is nowhere to copy to.');

  logger.info('Data backfill starting', { source, target, mode, sampleSize, only });

  await mongoose.connect(mongoUrl);
  const client = postgres(postgresUrl, { max: 1 });
  try {
    const mongo = mongoose.connection.db;
    if (!mongo) throw new Error('Mongo connected but published no database handle.');

    // Both guards before anything is read and long before anything is written.
    await assertMigrationSource(
      mongo,
      source,
      only.map((name) => DATA_PLANS[name].sourceCollection),
    );
    await assertMigrationTarget(client, target);

    const database = drizzle(client, { schema, casing: DATABASE_CASING });
    const report = await runDataBackfill({ mongo, database, mode, sampleSize, only });
    logger.info('Data backfill complete', {
      source,
      target,
      mode,
      resolutions: report.resolutions,
    });
  } finally {
    await client.end({ timeout: CLOSE_TIMEOUT_SECONDS });
    await mongoose.disconnect();
  }
}

// `require.main === module` rather than an unconditional call: this file is both
// a CLI entrypoint and a module the tests import for its exported pieces.
if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('Data backfill failed', error);
    // Not `process.exit`: it would truncate the very message that says what went
    // wrong. The event loop is free once both connections are closed.
    process.exitCode = 1;
  });
}
