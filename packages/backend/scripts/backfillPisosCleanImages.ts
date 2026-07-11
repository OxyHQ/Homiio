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
 * Usage (inside the VPC / ECS one-off; needs Mongo + the pisos proxy/browser env):
 *   bun run packages/backend/scripts/backfillPisosCleanImages.ts            # dry-run
 *   bun run packages/backend/scripts/backfillPisosCleanImages.ts --apply
 *   ... --apply --limit=25 --concurrency=2 --min-width=700
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

import { Types } from 'mongoose';
import {
  createDefaultRegistry,
  createListingFetchRuntimeFromEnv,
  type ExternalListingRef,
  type FetchRuntime,
  type ListingFetchRuntimeHandle,
  type ListingProvider,
} from '@homiio/listing-providers';
import database from '../database/connection';
import { Property, Image } from '../models';
import { ExternalMediaIngest } from '../services/ingestion/ExternalMediaIngest';
import imageUploadService from '../services/imageUploadService';

/** Min original width (px) that marks a re-hosted rendition as a watermarked hero. */
const DEFAULT_WATERMARK_MIN_WIDTH = 700;

/** Abort budget (ms) for re-fetching one listing's detail page. */
const FETCH_TIMEOUT_MS = 90_000;

/** How many properties' referenced images to resolve widths for per DB round-trip. */
const WIDTH_LOOKUP_BATCH = 500;

/** Default parallel re-fetch/replace workers (tune down if DataDome throttles). */
const DEFAULT_CONCURRENCY = 3;

/** Minimal pisos Property projection the scan needs. */
interface LeanPisosProperty {
  _id: Types.ObjectId;
  sourceId?: string;
  sourceUrl?: string;
  images?: Array<{ imageId?: string | Types.ObjectId }>;
}

/** Minimal Image projection: identity, source width, storage keys to delete. */
interface LeanImageWidth {
  _id: Types.ObjectId;
  width?: number;
  keys?: { original?: string; small?: string; medium?: string; large?: string };
}

/** A property flagged for backfill plus the counts the summary reports. */
interface Candidate {
  id: Types.ObjectId;
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
function storageKeysOf(image: LeanImageWidth): string[] {
  const keys = image.keys;
  if (!keys) return [];
  return [keys.original, keys.small, keys.medium, keys.large].filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  );
}

/** Resolve the width of every referenced image, batched, into an id→width map. */
async function loadReferencedWidths(
  properties: readonly LeanPisosProperty[],
): Promise<Map<string, number | undefined>> {
  const widthById = new Map<string, number | undefined>();
  const allIds: Types.ObjectId[] = [];
  for (const property of properties) {
    for (const ref of property.images ?? []) {
      if (ref.imageId && Types.ObjectId.isValid(String(ref.imageId))) {
        allIds.push(new Types.ObjectId(String(ref.imageId)));
      }
    }
  }
  for (let i = 0; i < allIds.length; i += WIDTH_LOOKUP_BATCH) {
    const batch = allIds.slice(i, i + WIDTH_LOOKUP_BATCH);
    const docs = await Image.find({ _id: { $in: batch } }, { width: 1 }).lean<LeanImageWidth[]>();
    for (const doc of docs) {
      widthById.set(String(doc._id), doc.width);
    }
  }
  return widthById;
}

interface ScanResult {
  scanned: number;
  candidates: Candidate[];
  cleanProperties: number;
  imagelessProperties: number;
  /** width bucket -> count, across every referenced pisos image (reporting). */
  widthDistribution: Map<string, number>;
}

/** Classify every pisos property as watermarked (candidate), clean, or imageless. */
async function scan(minWidth: number): Promise<ScanResult> {
  const properties = await Property.find(
    { source: 'pisos' },
    { sourceId: 1, sourceUrl: 1, 'images.imageId': 1 },
  ).lean<LeanPisosProperty[]>();

  const widthById = await loadReferencedWidths(properties);
  const widthDistribution = new Map<string, number>();
  const candidates: Candidate[] = [];
  let cleanProperties = 0;
  let imagelessProperties = 0;

  for (const property of properties) {
    const refs = property.images ?? [];
    if (refs.length === 0) {
      imagelessProperties += 1;
      continue;
    }
    let watermarkedCount = 0;
    for (const ref of refs) {
      const width = ref.imageId ? widthById.get(String(ref.imageId)) : undefined;
      const bucket = typeof width === 'number' ? String(width) : 'unknown';
      widthDistribution.set(bucket, (widthDistribution.get(bucket) ?? 0) + 1);
      if (typeof width === 'number' && width >= minWidth) watermarkedCount += 1;
    }
    if (watermarkedCount === 0) {
      cleanProperties += 1;
      continue;
    }
    const sourceId = typeof property.sourceId === 'string' ? property.sourceId : '';
    const sourceUrl = typeof property.sourceUrl === 'string' ? property.sourceUrl : '';
    if (!sourceId || !sourceUrl) {
      // Cannot re-fetch without a stable id + URL; report but do not touch.
      continue;
    }
    candidates.push({
      id: property._id,
      sourceId,
      sourceUrl,
      currentImageCount: refs.length,
      watermarkedCount,
    });
  }

  return {
    scanned: properties.length,
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
  const doc = await Property.findById(candidate.id);
  if (!doc) {
    return { status: 'gone', newImageCount: newRefs.length, deletedImageDocs: 0, deletedBlobs: 0 };
  }
  doc.set('images', newRefs);
  await doc.save();

  // Sweep every Image doc for this property that the new gallery does NOT
  // reference (the stale watermarked set + any orphan from a prior interrupted
  // run) and delete its S3 blobs, then the docs.
  const keepIds = new Set(newRefs.map((newRef) => String(newRef.imageId)));
  const allImages = await Image.find(
    { entityType: 'property', entityId: candidate.id },
    { keys: 1 },
  ).lean<LeanImageWidth[]>();
  const stale = allImages.filter((image) => !keepIds.has(String(image._id)));
  const staleKeys = stale.flatMap(storageKeysOf);

  let deletedBlobs = 0;
  if (staleKeys.length > 0) {
    try {
      await imageUploadService.deleteImageVariants(staleKeys);
      deletedBlobs = staleKeys.length;
    } catch (error) {
      console.warn(
        `  ! S3 blob delete failed for ${candidate.id.toString()} (${staleKeys.length} keys): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (stale.length > 0) {
    await Image.deleteMany({ _id: { $in: stale.map((image) => image._id) } });
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

  await database.connect();

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
      `  - ${candidate.id.toString()} imgs=${candidate.currentImageCount} ` +
        `wm=${candidate.watermarkedCount} ${candidate.sourceUrl}`,
    );
  }

  if (!options.apply) {
    console.log('\nDry-run only — no writes, no S3 deletions. Re-run with --apply to replace.');
    await database.disconnect?.();
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

  await database.disconnect?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
