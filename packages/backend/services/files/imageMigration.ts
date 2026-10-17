/**
 * Copying the photos in Homiio's bucket into Oxy Files (ADR 0043 stage 4) —
 * the logic behind `scripts/migrateImagesToOxy.ts`, kept here so it is tested.
 *
 * ## What moves, and to whom
 *
 * Only a row something SHOWS (`db/images/unusedImages.ts` defines "shown");
 * a row nothing shows is deleted by the unused-image sweep instead, so it is
 * never copied — that is the 948 orphans' end.
 *
 * | The row is shown by                 | It becomes                                   |
 * |-------------------------------------|----------------------------------------------|
 * | a host's own listing                | a file of the HOST's account (`uploadUserMedia`) |
 * | a scraped listing (`is_external`)   | a file of the HOMIIO application (batch import) |
 * | an eviction case                    | a file of the ORGANISER's account            |
 * | a city or region cover only         | not copied — RE-SOURCED (below)              |
 *
 * A legacy city cover came from Wikimedia Commons with no credit stored, and
 * Commons licences require one. Copying the bytes would carry the defect into
 * Oxy, so a legacy city cover is instead re-imported through the credited
 * sync (`ensureCover(cityId, { force: true })`); one Commons cannot credit is
 * cleared — Homiio must not show what it cannot credit. A region cover has no
 * source at all and is cleared. The replaced rows become unshown and the sweep
 * removes them.
 *
 * A host whose Oxy account is gone (Oxy refuses the owner) cannot own the
 * file; the photo is still on a live listing, so it becomes Homiio's file and
 * the report says so (`owner_fallback`).
 *
 * ## Imported fifty at a time, within Oxy's budget
 *
 * Production holds about two million scraped photos. Oxy meters an
 * application's uploads and imports together at 30 requests a minute, and a
 * batch import of 50 files is ONE request, while an upload is one per file —
 * two million uploads is seven weeks, the same photos as batch imports a day.
 * So a Homiio-owned photo is IMPORTED: Oxy fetches it from the legacy door
 * (`GET /api/images/file/<key>`, which serves the bucket's bytes until the row
 * moves), registering the listing's use in the same request like the live
 * ingest does. Every metered call goes through `OxyCallPacer`, which leaves
 * part of the budget to the live ingest and waits out a 429 instead of
 * recording it as the row's failure.
 *
 * ## Verified, resumable, and quiet about where bytes live
 *
 * Each object is read from the bucket and hashed here, and the SHA-256 Oxy
 * answers for what it stored (uploaded, or fetched through the legacy door) is
 * compared with Homiio's before the row is touched; a mismatch leaves the row
 * as it was. The row is updated only while it still has no Oxy file, so a
 * second run — or a run killed half way — redoes nothing: rows that moved are
 * not selected again, and an upload Oxy already holds answers the same file
 * (per-owner SHA-256 dedupe; an import of a URL already imported answers its
 * file without fetching). Reports name rows by id and bytes by SHA-256,
 * never by key or URL.
 *
 * Updating `images.oxy_file_id` fires the images trigger, so every listing
 * showing the row is marked and the drain registers its use with Oxy.
 */

import { createHash } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import {
  detachImageFromListings,
  repointPropertyImageUrls,
} from '../../db/properties/propertyWrites';
import { cities, evictionCases, images, regions } from '../../db/schema';
import { mapWithConcurrency } from '../../utils/concurrency';
import { ensureCover } from '../cityCoverSyncService';
import { oxyImageUrls } from './imageUrls';
import { legacyImageUrl } from './legacyImages';
import { legacyObjectStore } from './legacyObjectStore';
import type { OxyCallPacer } from './oxyCallPacer';
import { oxyErrorCode, oxyErrorStatus, oxyFiles } from './oxyFilesClient';

/** A shown legacy row and who its file should belong to. */
export interface LegacyImageCandidate {
  imageId: string;
  entityType: string;
  keysOriginal: string;
  /** `account` with an owner, `application`, or `cover` (re-sourced, not copied). */
  target:
    | { kind: 'account'; ownerOxyUserId: string }
    /** `listingId`: the listing whose use the import registers. */
    | { kind: 'application'; listingId: string }
    | { kind: 'city_cover'; cityIds: string[] }
    | { kind: 'region_cover'; regionIds: string[] };
}

export type MigrationOutcome =
  | 'migrated'
  | 'owner_fallback'
  | 'missing_object'
  | 'hash_mismatch'
  | 'upload_failed'
  | 'resourced_cover'
  | 'cleared_cover'
  /** Commons or Oxy did not answer for a city cover; it is tried again next run. */
  | 'cover_failed'
  | 'already_migrated';

/** One report line: row id, outcome and bytes' identity — never a key or URL. */
export interface MigrationReportLine {
  imageId: string;
  entityType: string;
  owner?: 'account' | 'application';
  outcome: MigrationOutcome;
  sha256?: string;
  bytes?: number;
  oxyFileId?: string;
  error?: string;
}

/**
 * The next page of shown rows not yet in Oxy, in id order after `afterId`,
 * each with its target. A row shown by a listing AND a cover follows the
 * listing (the cover is re-sourced separately when it is the city's).
 */
export async function findLegacyImages(
  afterId: string | null,
  limit: number,
): Promise<LegacyImageCandidate[]> {
  const rows = await getDb().execute<{
    id: string;
    entity_type: string;
    keys_original: string;
    listing_id: string | null;
    listing_owner: string | null;
    listing_external: boolean | null;
    case_owner: string | null;
    city_ids: string[] | null;
    region_ids: string[] | null;
  }>(sql`
    select i.id, i.entity_type, i.keys_original,
      (select p.id from property_images pi join properties p on p.id = pi.property_id
        where pi.image_id = i.id order by p.id limit 1) as listing_id,
      (select p.oxy_user_id from property_images pi join properties p on p.id = pi.property_id
        where pi.image_id = i.id order by p.id limit 1) as listing_owner,
      (select p.is_external from property_images pi join properties p on p.id = pi.property_id
        where pi.image_id = i.id order by p.id limit 1) as listing_external,
      (select e.oxy_user_id from eviction_cases e where e.cover_image_id = i.id order by e.id limit 1) as case_owner,
      (select array_agg(c.id order by c.id) from cities c where c.cover_image_id = i.id) as city_ids,
      (select array_agg(r.id order by r.id) from regions r where r.cover_image_id = i.id) as region_ids
    from images i
    where i.oxy_file_id is null
      and ${afterId === null ? sql`true` : sql`i.id > ${afterId}`}
      and (
        exists (select 1 from property_images pi where pi.image_id = i.id)
        or exists (select 1 from cities c where c.cover_image_id = i.id)
        or exists (select 1 from regions r where r.cover_image_id = i.id)
        or exists (select 1 from eviction_cases e where e.cover_image_id = i.id)
      )
    order by i.id
    limit ${limit}
  `);
  return rows.map((row): LegacyImageCandidate => {
    const base = { imageId: row.id, entityType: row.entity_type, keysOriginal: row.keys_original };
    if (row.listing_id && row.listing_external === true) {
      return { ...base, target: { kind: 'application', listingId: row.listing_id } };
    }
    if (row.listing_id && row.listing_external === false) {
      return row.listing_owner
        ? { ...base, target: { kind: 'account', ownerOxyUserId: row.listing_owner } }
        : { ...base, target: { kind: 'application', listingId: row.listing_id } };
    }
    if (row.case_owner)
      return { ...base, target: { kind: 'account', ownerOxyUserId: row.case_owner } };
    if (row.city_ids && row.city_ids.length > 0) {
      return { ...base, target: { kind: 'city_cover', cityIds: row.city_ids } };
    }
    return { ...base, target: { kind: 'region_cover', regionIds: row.region_ids ?? [] } };
  });
}

/** How the backfill runs its metered Oxy calls and how much it does at once. */
export interface MigrateLegacyImagesOptions {
  /** Paces every upload/import; absent, calls go out unpaced (tests). */
  pacer?: OxyCallPacer;
  /** Batch imports, uploads and bucket reads in flight at once. */
  concurrency?: number;
}

/** Oxy's batch import takes at most 50 items per request. */
const IMPORT_BATCH_SIZE = 50;

type OxyCallRunner = <T>(call: () => Promise<T>) => Promise<T>;

function runnerOf(options: MigrateLegacyImagesOptions): OxyCallRunner {
  const { pacer } = options;
  return pacer ? (call) => pacer.run(call) : (call) => call();
}

function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The status (and code) a failed call answered, for a report line. */
function failureOf(error: unknown): string {
  const status = oxyErrorStatus(error);
  const code = oxyErrorCode(error);
  return code ? `${status ?? 'transport'} ${code}` : `${status ?? 'transport'}`;
}

/**
 * Point the row (and the denormalized copies every listing read serves) at the
 * Oxy file — only while it still has none, so a concurrent run or a re-run
 * never moves it twice. False when another run got there first.
 */
async function pointRowAtOxy(
  imageId: string,
  fileId: string,
  owner: 'account' | 'application',
): Promise<boolean> {
  const urls = oxyImageUrls(fileId);
  return getDb().transaction(async (tx) => {
    const updated = await tx
      .update(images)
      .set({
        oxyFileId: fileId,
        oxyFileOwner: owner,
        oxyFileStatus: 'active',
        oxyFileVisibility: 'public',
        urlsOriginal: urls.original,
        urlsSmall: urls.small,
        urlsMedium: urls.medium,
        urlsLarge: urls.large,
      })
      .where(sql`${images.id} = ${imageId} and ${images.oxyFileId} is null`)
      .returning({ id: images.id });
    if (updated.length === 0) return false;
    await repointPropertyImageUrls(imageId, urls, tx);
    return true;
  });
}

/**
 * Up to 50 Homiio-owned photos in ONE metered request: each object is read and
 * hashed here, Oxy imports it from the legacy door (registering the listing's
 * use), and a row moves only when Oxy's SHA-256 is the one computed here.
 */
async function importApplicationBatch(
  batch: LegacyImageCandidate[],
  run: OxyCallRunner,
): Promise<MigrationReportLine[]> {
  const read = await mapWithConcurrency(batch, 8, async (candidate) => ({
    candidate,
    object: await legacyObjectStore().get(candidate.keysOriginal),
  }));
  const lines = new Map<string, MigrationReportLine>();
  const present: Array<{ candidate: LegacyImageCandidate; sha256: string; bytes: number }> = [];
  for (const { candidate, object } of read) {
    const base = { imageId: candidate.imageId, entityType: candidate.entityType };
    if (!object) {
      lines.set(candidate.imageId, { ...base, owner: 'application', outcome: 'missing_object' });
    } else {
      present.push({ candidate, sha256: sha256Of(object.buffer), bytes: object.buffer.length });
    }
  }

  if (present.length > 0) {
    const items = present.map(({ candidate }) => ({
      sourceUrl: legacyImageUrl(candidate.keysOriginal),
      visibility: 'public' as const,
      ...(candidate.target.kind === 'application'
        ? { reference: { entityType: 'property' as const, entityId: candidate.target.listingId } }
        : {}),
    }));
    let results: Awaited<ReturnType<ReturnType<typeof oxyFiles>['importAppFiles']>> | undefined;
    let batchError: string | undefined;
    try {
      results = await run(() => oxyFiles().importAppFiles(items));
    } catch (error) {
      batchError = failureOf(error);
    }
    const byIndex = new Map((results ?? []).map((result) => [result.index, result]));

    await mapWithConcurrency(present, 8, async ({ candidate, sha256, bytes }, index) => {
      const base = {
        imageId: candidate.imageId,
        entityType: candidate.entityType,
        owner: 'application' as const,
        sha256,
        bytes,
      };
      const result = byIndex.get(index);
      if (!result || !result.ok) {
        const error =
          result && !result.ok
            ? `${result.error.status} ${result.error.code}`
            : (batchError ?? '502 NO_ANSWER');
        lines.set(candidate.imageId, { ...base, outcome: 'upload_failed', error });
        return;
      }
      const fileId = result.file.id;
      if (result.file.sha256 !== sha256) {
        lines.set(candidate.imageId, { ...base, outcome: 'hash_mismatch', oxyFileId: fileId });
        return;
      }
      const moved = await pointRowAtOxy(candidate.imageId, fileId, 'application');
      lines.set(candidate.imageId, {
        ...base,
        outcome: moved ? 'migrated' : 'already_migrated',
        oxyFileId: fileId,
      });
    });
  }

  return batch.map((candidate) => lines.get(candidate.imageId) as MigrationReportLine);
}

/**
 * A person's photo: read, hashed, uploaded into THEIR account (or, when Oxy no
 * longer has the account, Homiio's — the photo is on a live listing), verified.
 */
async function copyToAccount(
  candidate: LegacyImageCandidate,
  ownerOxyUserId: string,
  run: OxyCallRunner,
): Promise<MigrationReportLine> {
  const base = { imageId: candidate.imageId, entityType: candidate.entityType };
  const object = await legacyObjectStore().get(candidate.keysOriginal);
  if (!object) return { ...base, owner: 'account', outcome: 'missing_object' };

  const sha256 = sha256Of(object.buffer);
  // The original rendition was always written as JPEG by the old pipeline.
  const mime = object.contentType.startsWith('image/') ? object.contentType : 'image/jpeg';
  const assets = oxyFiles();

  let fileId: string;
  let storedSha: string;
  let ownerKind: 'account' | 'application' = 'account';
  let outcome: MigrationOutcome = 'migrated';
  try {
    try {
      const file = await run(() =>
        assets.uploadUserMedia(ownerOxyUserId, object.buffer, mime, { timeout: 120_000 }),
      );
      fileId = file.id;
      storedSha = file.sha256;
    } catch (error) {
      // 403: Oxy has no such local account any more. The photo is on a live
      // listing, so it is kept — as Homiio's.
      if (oxyErrorStatus(error) !== 403) throw error;
      const uploaded = await run(() =>
        assets.uploadAppFile(object.buffer, mime, { visibility: 'public', timeout: 120_000 }),
      );
      fileId = uploaded.file.id;
      storedSha = uploaded.file.sha256;
      ownerKind = 'application';
      outcome = 'owner_fallback';
    }
  } catch (error) {
    return {
      ...base,
      owner: 'account',
      outcome: 'upload_failed',
      sha256,
      bytes: object.buffer.length,
      error: failureOf(error),
    };
  }

  if (storedSha !== sha256) {
    return { ...base, owner: ownerKind, outcome: 'hash_mismatch', sha256, oxyFileId: fileId };
  }
  const moved = await pointRowAtOxy(candidate.imageId, fileId, ownerKind);
  return {
    ...base,
    owner: ownerKind,
    outcome: moved ? outcome : 'already_migrated',
    sha256,
    bytes: object.buffer.length,
    oxyFileId: fileId,
  };
}

/**
 * A legacy cover: a city's re-sourced with credit, or cleared when Commons
 * cannot credit one; a region's cleared. A city whose re-sourcing FAILED
 * (Commons or Oxy did not answer) keeps its cover for the next run — only
 * Commons' own "nothing creditable" clears it.
 */
async function resolveLegacyCover(
  candidate: LegacyImageCandidate,
  run: OxyCallRunner,
): Promise<MigrationReportLine> {
  const base = { imageId: candidate.imageId, entityType: candidate.entityType };
  if (candidate.target.kind === 'city_cover') {
    let cleared = false;
    let failed: string | undefined;
    for (const cityId of candidate.target.cityIds) {
      const outcome = await ensureCover(cityId, { force: true, runOxyCall: run });
      if (outcome.kind === 'failed') {
        failed = `${outcome.stage} ${outcome.status ?? 'transport'}`;
        continue;
      }
      if (outcome.kind !== 'uncreditable') continue;
      const result = await getDb()
        .update(cities)
        .set({ coverImageId: null })
        .where(sql`${cities.id} = ${cityId} and ${cities.coverImageId} = ${candidate.imageId}`)
        .returning({ id: cities.id });
      if (result.length > 0) cleared = true;
    }
    if (failed) return { ...base, outcome: 'cover_failed', error: failed };
    return { ...base, outcome: cleared ? 'cleared_cover' : 'resourced_cover' };
  }
  if (candidate.target.kind === 'region_cover') {
    await getDb()
      .update(regions)
      .set({ coverImageId: null })
      .where(eq(regions.coverImageId, candidate.imageId));
    return { ...base, outcome: 'cleared_cover' };
  }
  throw new Error('not a cover');
}

/**
 * Move a page of rows. Homiio-owned photos go 50 to a batch import, a
 * person's one upload each, covers one at a time (each is a Commons search);
 * `concurrency` batches or uploads are in flight at once. Never throws for a
 * per-row problem — the line's outcome says it — and answers in input order.
 */
export async function migrateLegacyImages(
  candidates: readonly LegacyImageCandidate[],
  options: MigrateLegacyImagesOptions = {},
): Promise<MigrationReportLine[]> {
  const run = runnerOf(options);
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const lines = new Map<string, MigrationReportLine>();

  const applicationRows = candidates.filter((c) => c.target.kind === 'application');
  const batches: LegacyImageCandidate[][] = [];
  for (let start = 0; start < applicationRows.length; start += IMPORT_BATCH_SIZE) {
    batches.push(applicationRows.slice(start, start + IMPORT_BATCH_SIZE));
  }
  const accountRows = candidates.filter((c) => c.target.kind === 'account');

  await Promise.all([
    mapWithConcurrency(batches, concurrency, async (batch) => {
      for (const line of await importApplicationBatch(batch, run)) lines.set(line.imageId, line);
    }),
    mapWithConcurrency(accountRows, concurrency, async (candidate) => {
      if (candidate.target.kind !== 'account') return;
      lines.set(
        candidate.imageId,
        await copyToAccount(candidate, candidate.target.ownerOxyUserId, run),
      );
    }),
    (async () => {
      for (const candidate of candidates) {
        if (candidate.target.kind === 'city_cover' || candidate.target.kind === 'region_cover') {
          lines.set(candidate.imageId, await resolveLegacyCover(candidate, run));
        }
      }
    })(),
  ]);

  return candidates.map((candidate) => lines.get(candidate.imageId) as MigrationReportLine);
}

/** Move one row (`migrateLegacyImages` of one). */
export async function migrateLegacyImage(
  candidate: LegacyImageCandidate,
  options: MigrateLegacyImagesOptions = {},
): Promise<MigrationReportLine> {
  const [line] = await migrateLegacyImages([candidate], options);
  return line;
}

/**
 * A shown row whose object is not in the bucket can never be displayed — its
 * listings render a broken photo today. With `--detach-missing` the script
 * takes it off every listing and case that shows it (re-deriving
 * `has_images`), so the row becomes unshown and the sweep removes it. Off by
 * default: an operator reads the `missing_object` lines first.
 */
export async function detachMissingImage(imageId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await detachImageFromListings(imageId, tx);
    await tx
      .update(evictionCases)
      .set({ coverImageId: null, coverImageUrl: null })
      .where(eq(evictionCases.coverImageId, imageId));
  });
}

/** What is left to do — the preview, and the migration half of the retirement gate. */
export async function countLegacyImages(): Promise<
  Array<{ target: 'listing' | 'eviction_case' | 'city_cover' | 'region_cover'; rows: number }>
> {
  const rows = await getDb().execute<{ target: string; rows: string }>(sql`
    select case
             when exists (select 1 from property_images pi where pi.image_id = i.id) then 'listing'
             when exists (select 1 from eviction_cases e where e.cover_image_id = i.id) then 'eviction_case'
             when exists (select 1 from cities c where c.cover_image_id = i.id) then 'city_cover'
             else 'region_cover'
           end as target,
           count(*)::text as rows
    from images i
    where i.oxy_file_id is null
      and (
        exists (select 1 from property_images pi where pi.image_id = i.id)
        or exists (select 1 from cities c where c.cover_image_id = i.id)
        or exists (select 1 from regions r where r.cover_image_id = i.id)
        or exists (select 1 from eviction_cases e where e.cover_image_id = i.id)
      )
    group by 1
    order by 1
  `);
  return rows.map((row) => ({
    target: row.target as 'listing' | 'eviction_case' | 'city_cover' | 'region_cover',
    rows: Number(row.rows),
  }));
}
