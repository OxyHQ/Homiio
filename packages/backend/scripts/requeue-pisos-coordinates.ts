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
 * Requires REDIS_URL (Valkey) for --apply. DATABASE_URL via the standard backend .env.
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { Queue } from 'bullmq';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { PropertyStatus } from '@homiio/shared-types';
import type { ExternalListingRef } from '@homiio/listing-providers';
import {
  QUEUE_NAMES,
  fetchJobId,
  parseRedisConnection,
  type FetchJobData,
} from '../services/ingestion/queues';

import { closePostgres, connectPostgres, getDb } from '../db/postgres';
import { addresses, properties } from '../db/schema';

const APPLY = process.argv.includes('--apply');

/** Nominatim Madrid centroid returned when street geocode failed and city defaulted to Madrid. */
const MADRID_CENTROID_LAT = 40.416782;
const MADRID_CENTROID_LNG = -3.703507;
const COORD_EPSILON = 0.0002;

async function main(): Promise<void> {
  await connectPostgres();

  // ONE join, and the centroid test is a WHERE clause.
  //
  // The Mongo version could do neither: it opened a raw cursor over every
  // published pisos listing and issued an `Address.findById` PER ROW to read
  // two coordinates, then filtered in JS. It also had to unwrap three possible
  // shapes of the address reference (`addressId`, a legacy `address`, and a
  // populated object) — `properties.address_id` is a `text` foreign key with
  // exactly one shape, so that unwrapping is gone rather than ported.
  const stuckRows = await getDb()
    .select({
      sourceId: properties.sourceId,
      sourceUrl: properties.sourceUrl,
    })
    .from(properties)
    .innerJoin(addresses, eq(properties.addressId, addresses.id))
    .where(
      and(
        eq(properties.source, 'pisos'),
        eq(properties.isExternal, true),
        eq(properties.status, PropertyStatus.PUBLISHED),
        isNotNull(properties.sourceId),
        isNotNull(properties.sourceUrl),
        ne(properties.sourceUrl, ''),
        // The same epsilon box the JS predicate applied, said in SQL.
        sql`abs(${addresses.latitude} - ${MADRID_CENTROID_LAT}) <= ${COORD_EPSILON}`,
        sql`abs(${addresses.longitude} - ${MADRID_CENTROID_LNG}) <= ${COORD_EPSILON}`,
      ),
    );

  const stuck = stuckRows
    .filter((row): row is { sourceId: string; sourceUrl: string } =>
      Boolean(row.sourceId && row.sourceUrl))
    .map((row) => ({
      sourceId: row.sourceId,
      sourceUrl: row.sourceUrl,
      ref: { provider: 'pisos', sourceId: row.sourceId, url: row.sourceUrl } as ExternalListingRef,
    }));

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
    await closePostgres();
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
  await closePostgres();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
