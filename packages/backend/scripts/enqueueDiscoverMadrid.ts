/**
 * Release stale BullMQ discover locks and enqueue Madrid-only discover jobs for
 * ES browser portals. Run inside the VPC (or ECS one-off) with REDIS_URL set.
 *
 * Usage:
 *   REDIS_URL=... bun run packages/backend/scripts/enqueueDiscoverMadrid.ts
 *   REDIS_URL=... bun run packages/backend/scripts/enqueueDiscoverMadrid.ts --providers=fotocasa,habitaclia
 */

import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  discoverJobId,
  parseRedisConnection,
  type DiscoverJobData,
} from '../services/ingestion/queues';

const DISCOVER_LOCK_MS = 600_000;
const MADRID = 'madrid';
const DEFAULT_PROVIDERS = ['habitaclia', 'fotocasa', 'idealista'] as const;

function parseProvidersArg(argv: string[]): string[] {
  const flag = argv.find((entry) => entry.startsWith('--providers='));
  if (!flag) return [...DEFAULT_PROVIDERS];
  return flag
    .slice('--providers='.length)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function removeJob(
  queue: Queue<DiscoverJobData>,
  jobId: string,
  reason: string,
): Promise<boolean> {
  const job = await queue.getJob(jobId);
  if (!job) return false;
  try {
    await job.remove();
    console.log(JSON.stringify({ action: 'removed', jobId, reason }));
    return true;
  } catch {
    try {
      await job.moveToFailed(new Error(reason), '0', true);
      console.log(JSON.stringify({ action: 'force-failed', jobId, reason }));
      return true;
    } catch (error) {
      console.log(
        JSON.stringify({
          action: 'skip',
          jobId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }
}

async function releaseStaleActive(queue: Queue<DiscoverJobData>): Promise<number> {
  const staleBefore = Date.now() - DISCOVER_LOCK_MS;
  const active = await queue.getJobs(['active'], 0, 50);
  let released = 0;
  for (const job of active) {
    const processedOn = job.processedOn ?? 0;
    if (processedOn > staleBefore) continue;
    if (await removeJob(queue, job.id ?? '', 'stale active discover')) released += 1;
  }
  return released;
}

async function purgeLegacyMarketWide(
  queue: Queue<DiscoverJobData>,
  provider: string,
): Promise<void> {
  const legacyScope: DiscoverJobData = { provider, market: 'ES' };
  const legacyId = discoverJobId(legacyScope);
  await removeJob(queue, legacyId, `legacy market-wide ${provider} discover`);
}

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error('REDIS_URL is required');

  const providers = parseProvidersArg(process.argv.slice(2));
  const prefix = process.env.LISTING_QUEUE_PREFIX || 'bull-homiio-listings';
  const connection = parseRedisConnection(redisUrl);
  const discoverQueue = new Queue<DiscoverJobData>(QUEUE_NAMES.discover, { connection, prefix });

  const released = await releaseStaleActive(discoverQueue);
  for (const provider of providers) {
    await purgeLegacyMarketWide(discoverQueue, provider);
  }

  const enqueued: string[] = [];
  for (const provider of providers) {
    const data: DiscoverJobData = { provider, market: 'ES', city: MADRID };
    const jobId = discoverJobId(data);
    await removeJob(discoverQueue, jobId, 're-enqueue madrid discover');
    await discoverQueue.add(QUEUE_NAMES.discover, data, { jobId });
    enqueued.push(jobId);
  }

  const counts = await discoverQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  console.log(
    JSON.stringify({
      releasedStaleActive: released,
      enqueued,
      discoverCounts: counts,
    }),
  );

  await discoverQueue.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
