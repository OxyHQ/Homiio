/**
 * Backfill: replace pisos.com watermarked listing images with clean renditions.
 *
 * ## Why
 * pisos.com serves every property photo under several `fotos.imghs.net` size
 * prefixes. The hero/cover renditions (`xl-wp`, `fch-wp`) and the `appswm-wp`
 * duplicate have the **pisos.com watermark** burned into the pixels; the agency
 * `prof-wp/logos/…` is not a property photo. Listings ingested BEFORE the parser
 * fix (`readPisosImageUrls`/`classifyPisosImage`, PR #193) re-hosted those
 * watermarked renditions to S3, so the stored gallery — and usually the primary
 * cover — shows the watermark. A normal re-fetch does NOT repair them: the ingest
 * only downloads media when the property has no images (`needsMedia`).
 *
 * ## Why re-fetch (not derive)
 * The original `fotos.imghs.net` URL is NOT persisted anywhere: each Image doc is
 * re-hosted under a fresh `uuidv4` storage key with no source-URL/hash field. The
 * clean `apps-wp` URL of a photo can only be learned from the (DataDome-gated)
 * detail page, so the clean gallery must be re-fetched + re-normalized with the
 * fixed parser. The listing HTML fetch uses the same proxy/browser ladder the
 * worker already runs; the clean photos themselves download DIRECT (no proxy).
 *
 * ## Detector (cheap, DB-only) + idempotency
 * A property needs the backfill iff any CURRENTLY-REFERENCED image has an original
 * width >= {@link DEFAULT_WATERMARK_MIN_WIDTH} — the 800-wide `xl`/`fch` hero the
 * fixed parser never keeps (verified: clean galleries are `apps-wp` 640-wide +
 * `fchm-wp` 400-wide only). After a successful replace the property references
 * only clean (<700-wide) images, so a re-run skips it — the detector IS the
 * idempotency guard. Orphaned Image docs from an interrupted run are swept on the
 * next pass (cleanup deletes every Image for the entity not in the new gallery).
 *
 * ## Safety
 * Dry-run by default (counts + width distribution, no writes, no S3 deletes).
 * `--apply` performs the replacement. Per property: re-fetch → normalize → ingest
 * clean media (new Image docs) → swap `Property.images` → then delete the stale
 * Image docs + their S3 blobs. New media is created and referenced BEFORE the old
 * is deleted, so a crash never leaves a property imageless, and a property is only
 * ever touched when a good clean replacement was produced.
 *
 * Usage (inside the VPC / ECS one-off; needs DATABASE_URL + the pisos proxy/browser env):
 *   bun run packages/backend/scripts/backfillPisosCleanImages.ts            # dry-run
 *   bun run packages/backend/scripts/backfillPisosCleanImages.ts --apply
 *   ... --apply --limit=25 --concurrency=2 --min-width=700
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import {
  createDefaultRegistry,
  createListingFetchRuntimeFromEnv,
  type ExternalListingRef,
  type FetchRuntime,
  type ListingFetchRuntimeHandle,
  type ListingProvider,
} from '@homiio/listing-providers';
import { eq } from 'drizzle-orm';

import { connectPostgres, closePostgres, getDb } from '../db/postgres';
import { images, properties, propertyImages } from '../db/schema';
import { deleteImagesByIds, findImagesForEntity } from '../db/images/imageWrites';
import { replacePropertyImages } from '../db/properties/propertyWrites';
import { ExternalMediaIngest } from '../services/ingestion/ExternalMediaIngest';
import imageUploadService from '../services/imageUploadService';

/** Min original width (px) that marks a re-hosted rendition as a watermarked hero. */
const DEFAULT_WATERMARK_MIN_WIDTH = 700;

/** Abort budget (ms) for re-fetching one listing's detail page. */
const FETCH_TIMEOUT_MS = 90_000;

/** Default parallel re-fetch/replace workers (tune down if DataDome throttles). */
const DEFAULT_CONCURRENCY = 3;

/** A property flagged for backfill plus the counts the summary reports. */
interface Candidate {
  id: string;
  sourceId: string;
  sourceUrl: string;
  currentImageCount: number;
  watermarkedCount: number;
}

interface CliOptions {
  apply: boolean;
  limit: number;
  concurrency: number;
  minWidth: number;
  /** This worker's index in a sharded run (0-based). */
  shardIndex: number;
  /** Total shards; 1 = process every candidate in one task. */
  shardTotal: number;
}

function parseCli(argv: string[]): CliOptions {
  const apply = argv.includes('--apply');
  const numeric = (flag: string, fallback: number): number => {
    const entry = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (!entry) return fallback;
    const value = Number.parseInt(entry.slice(flag.length + 1), 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  // `--shard=INDEX/TOTAL` splits the candidate list across parallel tasks so
  // each task can run its own sticky proxy IP (independent anti-bot session).
  let shardIndex = 0;
  let shardTotal = 1;
  const shardEntry = argv.find((arg) => arg.startsWith('--shard='));
  if (shardEntry) {
    const [rawIndex, rawTotal] = shardEntry.slice('--shard='.length).split('/');
    const total = Number.parseInt(rawTotal ?? '', 10);
    const index = Number.parseInt(rawIndex ?? '', 10);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(index) && index >= 0 && index < total) {
      shardIndex = index;
      shardTotal = total;
    } else {
      throw new Error(`Invalid --shard value "${shardEntry}", expected INDEX/TOTAL with 0<=INDEX<TOTAL`);
    }
  }
  return {
    apply,
    limit: numeric('--limit', Number.POSITIVE_INFINITY),
    concurrency: numeric('--concurrency', DEFAULT_CONCURRENCY),
    minWidth: numeric('--min-width', DEFAULT_WATERMARK_MIN_WIDTH),
    shardIndex,
    shardTotal,
  };
}

/** All variant storage keys present on an Image doc (for S3 deletion). */
function storageKeysOf(image: {
  keysOriginal: string;
  keysSmall: string;
  keysMedium: string;
  keysLarge: string;
}): string[] {
  return [image.keysOriginal, image.keysSmall, image.keysMedium, image.keysLarge].filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  );
}

interface ScanResult {
  scanned: number;
  candidates: Candidate[];
  cleanProperties: number;
  imagelessProperties: number;
  /** width bucket -> count, across every referenced pisos image (reporting). */
  widthDistribution: Map<string, number>;
}

/**
 * Classify every pisos property as watermarked (candidate), clean, or imageless.
 *
 * ONE statement, where Mongo needed three phases (load every pisos listing,
 * collect its embedded image ids, then batch `Image.find` them 500 at a time).
 * `property_images` is a real table joined to `images`, so the width of each
 * referenced photo is just another column — which is why `WIDTH_LOOKUP_BATCH`
 * and `loadReferencedWidths` are gone rather than ported: they existed to work
 * around the absence of a join, not to bound memory.
 *
 * A listing with no photos produces one row with NULLs from the LEFT JOIN
 * rather than being absent, so the imageless count stays observable.
 */
async function scan(minWidth: number): Promise<ScanResult> {
  const rows = await getDb()
    .select({
      id: properties.id,
      sourceId: properties.sourceId,
      sourceUrl: properties.sourceUrl,
      imageId: propertyImages.imageId,
      width: images.width,
    })
    .from(properties)
    .leftJoin(propertyImages, eq(propertyImages.propertyId, properties.id))
    .leftJoin(images, eq(images.id, propertyImages.imageId))
    .where(eq(properties.source, 'pisos'));

  const widthDistribution = new Map<string, number>();
  const candidates: Candidate[] = [];
  let cleanProperties = 0;
  let imagelessProperties = 0;

  // Regroup the joined rows by listing. The grouping is done here rather than in
  // SQL because the width DISTRIBUTION the report prints needs every individual
  // photo, not an aggregate per listing.
  const byProperty = new Map<
    string,
    { sourceId: string | null; sourceUrl: string | null; widths: (number | null)[] }
  >();
  for (const row of rows) {
    const entry = byProperty.get(row.id) ?? {
      sourceId: row.sourceId,
      sourceUrl: row.sourceUrl,
      widths: [],
    };
    if (row.imageId !== null) entry.widths.push(row.width);
    byProperty.set(row.id, entry);
  }

  for (const [id, property] of byProperty) {
    if (property.widths.length === 0) {
      imagelessProperties += 1;
      continue;
    }
    let watermarkedCount = 0;
    for (const width of property.widths) {
      const bucket = typeof width === 'number' ? String(width) : 'unknown';
      widthDistribution.set(bucket, (widthDistribution.get(bucket) ?? 0) + 1);
      if (typeof width === 'number' && width >= minWidth) watermarkedCount += 1;
    }
    if (watermarkedCount === 0) {
      cleanProperties += 1;
      continue;
    }
    if (!property.sourceId || !property.sourceUrl) {
      // Cannot re-fetch without a stable id + URL; report but do not touch.
      continue;
    }
    candidates.push({
      id,
      sourceId: property.sourceId,
      sourceUrl: property.sourceUrl,
      currentImageCount: property.widths.length,
      watermarkedCount,
    });
  }

  return {
    scanned: byProperty.size,
    candidates,
    cleanProperties,
    imagelessProperties,
    widthDistribution,
  };
}

type ReplaceStatus =
  | 'replaced'
  | 'refetch-no-images'
  | 'ingest-no-images'
  | 'gone'
  | 'fetch-error';

interface ReplaceOutcome {
  status: ReplaceStatus;
  newImageCount: number;
  deletedImageDocs: number;
  deletedBlobs: number;
  /** Failure reason (fetch/normalize error message), when the status is a failure. */
  detail?: string;
}

/** Re-fetch one listing, ingest clean media, swap it in, delete the stale media. */
async function replaceOne(
  candidate: Candidate,
  provider: ListingProvider,
  runtime: FetchRuntime,
  mediaIngest: ExternalMediaIngest,
): Promise<ReplaceOutcome> {
  const ref: ExternalListingRef = {
    provider: 'pisos',
    sourceId: candidate.sourceId,
    url: candidate.sourceUrl,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let remoteImages;
  try {
    const raw = await provider.fetch(ref, { runtime, signal: controller.signal });
    remoteImages = provider.normalize(raw).remoteImages;
  } catch (error) {
    return {
      status: 'fetch-error',
      newImageCount: 0,
      deletedImageDocs: 0,
      deletedBlobs: 0,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }

  if (!remoteImages || remoteImages.length === 0) {
    return { status: 'refetch-no-images', newImageCount: 0, deletedImageDocs: 0, deletedBlobs: 0 };
  }

  // Create the clean, re-hosted media first (new Image docs, entityId = property).
  const newRefs = await mediaIngest.ingestForProperty(candidate.id, remoteImages);
  if (newRefs.length === 0) {
    return { status: 'ingest-no-images', newImageCount: 0, deletedImageDocs: 0, deletedBlobs: 0 };
  }

  // Point the property at the clean gallery before deleting anything.
  const [stillThere] = await getDb()
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, candidate.id))
    .limit(1);
  if (!stillThere) {
    return { status: 'gone', newImageCount: newRefs.length, deletedImageDocs: 0, deletedBlobs: 0 };
  }
  await replacePropertyImages(candidate.id, newRefs);

  // Sweep every `images` row for this property that the new gallery does NOT
  // reference (the stale watermarked set + any orphan from a prior interrupted
  // run) and delete its S3 blobs, then the rows. The order matters and is
  // unchanged: `property_images.image_id` is an ON DELETE RESTRICT reference, so
  // the gallery has to stop pointing at a photo before the photo can go — which
  // is now enforced by the database rather than by this function's ordering.
  const keepIds = new Set(newRefs.map((newRef) => newRef.imageId));
  const allImages = await findImagesForEntity('property', candidate.id);
  const stale = allImages.filter((image) => !keepIds.has(image.id));
  const staleKeys = stale.flatMap(storageKeysOf);

  let deletedBlobs = 0;
  if (staleKeys.length > 0) {
    try {
      await imageUploadService.deleteImageVariants(staleKeys);
      deletedBlobs = staleKeys.length;
    } catch (error) {
      console.warn(
        `  ! S3 blob delete failed for ${candidate.id} (${staleKeys.length} keys): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (stale.length > 0) {
    await deleteImagesByIds(stale.map((image) => image.id));
  }

  return {
    status: 'replaced',
    newImageCount: newRefs.length,
    deletedImageDocs: stale.length,
    deletedBlobs,
  };
}

/** Run `worker` over `items` with at most `concurrency` in flight. */
async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}

function printWidthDistribution(distribution: Map<string, number>): void {
  const rows = [...distribution.entries()].sort((a, b) => b[1] - a[1]);
  console.log('Referenced-image original-width distribution (all pisos images):');
  for (const [bucket, count] of rows.slice(0, 20)) {
    console.log(`  width ${bucket.padStart(6)} : ${count}`);
  }
}

/** Shared media ingester (default env fetcher: clean pisos photos download direct). */
const mediaIngestSingleton = new ExternalMediaIngest();

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  console.log(
    `pisos watermark backfill — mode=${options.apply ? 'APPLY' : 'DRY-RUN'} ` +
      `minWidth=${options.minWidth} concurrency=${options.concurrency} ` +
      `limit=${Number.isFinite(options.limit) ? options.limit : 'all'} ` +
      `shard=${options.shardIndex}/${options.shardTotal}`,
  );

  await connectPostgres();

  const result = await scan(options.minWidth);
  console.log('--- scan ---');
  console.log(`pisos properties scanned : ${result.scanned}`);
  console.log(`already clean            : ${result.cleanProperties}`);
  console.log(`imageless (skipped)      : ${result.imagelessProperties}`);
  console.log(`WATERMARKED (candidates) : ${result.candidates.length}`);
  const totalWatermarkedImages = result.candidates.reduce((sum, c) => sum + c.watermarkedCount, 0);
  console.log(`watermarked images total : ${totalWatermarkedImages}`);
  printWidthDistribution(result.widthDistribution);
  console.log('sample candidates:');
  for (const candidate of result.candidates.slice(0, 10)) {
    console.log(
      `  - ${candidate.id} imgs=${candidate.currentImageCount} ` +
        `wm=${candidate.watermarkedCount} ${candidate.sourceUrl}`,
    );
  }

  if (!options.apply) {
    console.log('\nDry-run only — no writes, no S3 deletions. Re-run with --apply to replace.');
    await closePostgres();
    return;
  }

  const registry = createDefaultRegistry();
  if (!registry.has('pisos')) {
    throw new Error(
      'pisos provider not registered — set PROVIDER_PISOS_ENABLED=true in this task env',
    );
  }
  const provider = registry.get('pisos');
  const runtimeHandle: ListingFetchRuntimeHandle = await createListingFetchRuntimeFromEnv({
    onLog: (message) => console.log(`[runtime] ${message}`),
  });
  const runtime = runtimeHandle.runtime;
  console.log(
    `runtime ready — browserTier=${Boolean(runtime.fetchViaBrowser)} ` +
      `managedTier=${Boolean(runtime.fetchViaManaged)}`,
  );

  const sharded =
    options.shardTotal > 1
      ? result.candidates.filter((_, index) => index % options.shardTotal === options.shardIndex)
      : result.candidates;
  const toProcess = Number.isFinite(options.limit) ? sharded.slice(0, options.limit) : sharded;
  console.log(
    `\n--- applying to ${toProcess.length} propert${toProcess.length === 1 ? 'y' : 'ies'}` +
      `${options.shardTotal > 1 ? ` (shard ${options.shardIndex}/${options.shardTotal})` : ''} ---`,
  );

  const tally: Record<ReplaceStatus, number> = {
    replaced: 0,
    'refetch-no-images': 0,
    'ingest-no-images': 0,
    gone: 0,
    'fetch-error': 0,
  };
  let processed = 0;
  let deletedImageDocs = 0;
  let deletedBlobs = 0;

  try {
    await runPool(toProcess, options.concurrency, async (candidate) => {
      let outcome: ReplaceOutcome;
      try {
        outcome = await replaceOne(candidate, provider, runtime, mediaIngestSingleton);
      } catch (error) {
        console.warn(
          `  ! unexpected error for ${candidate.id.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        tally['fetch-error'] += 1;
        processed += 1;
        return;
      }
      tally[outcome.status] += 1;
      deletedImageDocs += outcome.deletedImageDocs;
      deletedBlobs += outcome.deletedBlobs;
      processed += 1;
      if (outcome.status === 'replaced') {
        console.log(
          `  [${processed}/${toProcess.length}] replaced ${candidate.id.toString()} ` +
            `new=${outcome.newImageCount} deletedDocs=${outcome.deletedImageDocs} ` +
            `deletedBlobs=${outcome.deletedBlobs}`,
        );
      } else {
        console.log(
          `  [${processed}/${toProcess.length}] ${outcome.status} ${candidate.id.toString()} ` +
            `(kept existing images)${outcome.detail ? ` — ${outcome.detail}` : ''}`,
        );
      }
    });
  } finally {
    await runtimeHandle.shutdown();
  }

  console.log('\n--- summary ---');
  console.log(`replaced            : ${tally.replaced}`);
  console.log(`refetch-no-images   : ${tally['refetch-no-images']}`);
  console.log(`ingest-no-images    : ${tally['ingest-no-images']}`);
  console.log(`property gone       : ${tally.gone}`);
  console.log(`fetch-error         : ${tally['fetch-error']}`);
  console.log(`stale Image docs deleted : ${deletedImageDocs}`);
  console.log(`stale S3 blobs deleted   : ${deletedBlobs}`);

  await closePostgres();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
