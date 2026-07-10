/**
 * Clear completed/failed BullMQ listing jobs so boot discovery can re-run fetch
 * passes after a worker redeploy. Safe to run against prod Valkey when queues
 * are stuck on stale failed fetch ids.
 *
 * Usage:
 *   REDIS_URL=... LISTING_QUEUE_PREFIX=bull-homiio-listings \
 *     bun run packages/backend/scripts/clearListingQueues.ts
 */

import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  parseRedisConnection,
} from '../services/ingestion/queues';

async function cleanQueue(name: string, prefix: string, connection: ReturnType<typeof parseRedisConnection>): Promise<void> {
  const queue = new Queue(name, { connection, prefix });
  const completed = await queue.clean(0, 1000, 'completed');
  const failed = await queue.clean(0, 1000, 'failed');
  const delayed = await queue.clean(0, 1000, 'delayed');
  console.log(JSON.stringify({ queue: name, removed: { completed, failed, delayed } }));
  await queue.close();
}

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is required');
  }
  const prefix = process.env.LISTING_QUEUE_PREFIX || 'bull-homiio-listings';
  const connection = parseRedisConnection(redisUrl);
  for (const name of Object.values(QUEUE_NAMES)) {
    await cleanQueue(name, prefix, connection);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
