/**
 * Re-queue pisos.com listings stuck at the Madrid city-centroid for worker re-fetch.
 *
 * Root cause: detail pages omit JSON-LD; coords live on the locationmap widget.
 * Listings ingested before that parser fix landed at ~40.416782,-3.703507.
 *
 * Usage:
 *   bun run packages/backend/scripts/requeue-pisos-coordinates.ts
 *   bun run packages/backend/scripts/requeue-pisos-coordinates.ts --apply
 *
 * Requires REDIS_URL (Valkey) for --apply. Mongo via standard backend .env.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

import { Queue } from 'bullmq';
import { PropertyStatus } from '@homiio/shared-types';
import type { ExternalListingRef } from '@homiio/listing-providers';
import {
  QUEUE_NAMES,
  fetchJobId,
  parseRedisConnection,
  type FetchJobData,
} from '../services/ingestion/queues';
import database from '../database/connection';

const { Property, Address } = require('../models');

const APPLY = process.argv.includes('--apply');

/** Nominatim Madrid centroid returned when street geocode failed and city defaulted to Madrid. */
const MADRID_CENTROID_LAT = 40.416782;
const MADRID_CENTROID_LNG = -3.703507;
const COORD_EPSILON = 0.0002;

function isMadridCentroid(lng: number, lat: number): boolean {
  return (
    Math.abs(lat - MADRID_CENTROID_LAT) <= COORD_EPSILON &&
    Math.abs(lng - MADRID_CENTROID_LNG) <= COORD_EPSILON
  );
}

async function main(): Promise<void> {
  await database.connect();

  const pisosProperties = await Property.find({
    source: 'pisos',
    isExternal: true,
    status: PropertyStatus.PUBLISHED,
    sourceUrl: { $exists: true, $type: 'string', $ne: '' },
  })
    .select({ sourceId: 1, sourceUrl: 1, addressId: 1 })
    .lean();

  const stuck: Array<{ sourceId: string; sourceUrl: string; ref: ExternalListingRef }> = [];

  for (const doc of pisosProperties) {
    const sourceId = typeof doc.sourceId === 'string' ? doc.sourceId : '';
    const sourceUrl = typeof doc.sourceUrl === 'string' ? doc.sourceUrl : '';
    if (!sourceId || !sourceUrl || !doc.addressId) continue;

    const address = await Address.findById(doc.addressId).select({ coordinates: 1 }).lean();
    const coords = address?.coordinates?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) continue;
    const [lng, lat] = coords;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    if (!isMadridCentroid(lng, lat)) continue;

    stuck.push({
      sourceId,
      sourceUrl,
      ref: { provider: 'pisos', sourceId, url: sourceUrl },
    });
  }

  console.log(
    `${APPLY ? 'Re-queueing' : 'Would re-queue'} ${stuck.length} pisos listing(s) at Madrid centroid`,
  );
  for (const row of stuck.slice(0, 20)) {
    console.log(`  - ${row.sourceId} ${row.sourceUrl}`);
  }
  if (stuck.length > 20) {
    console.log(`  … and ${stuck.length - 20} more`);
  }

  if (!APPLY) {
    await database.disconnect?.();
    return;
  }

  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for --apply');
  }

  const connection = parseRedisConnection(redisUrl);
  const prefix = process.env.BULLMQ_PREFIX?.trim() || 'homiio';
  const fetchQueue = new Queue<FetchJobData>(QUEUE_NAMES.fetch, { connection, prefix });

  let enqueued = 0;
  let skipped = 0;
  for (const row of stuck) {
    const jobId = fetchJobId(row.ref);
    const existing = await fetchQueue.getJob(jobId);
    const state = existing ? await existing.getState() : undefined;
    if (state === 'waiting' || state === 'active' || state === 'delayed') {
      skipped += 1;
      continue;
    }
    await fetchQueue.add(QUEUE_NAMES.fetch, { ref: row.ref }, { jobId });
    enqueued += 1;
  }

  console.log(`Enqueued ${enqueued} fetch job(s); skipped ${skipped} already pending/active`);
  await fetchQueue.close();
  await database.disconnect?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
