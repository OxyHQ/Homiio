/**
 * Listing-ingestion worker entrypoint.
 *
 * A separate process from the API (the API NEVER scrapes). It owns the provider
 * plugins from `@homiio/listing-providers`, pulls jobs off the BullMQ queues on
 * the existing `REDIS_URL`, and drives the fetch → normalize → ingest pipeline
 * through the backend {@link IngestionService}. Runs in the same repo/image as
 * the API with a different command (`bun run worker`).
 *
 * Redis is env-gated: with `REDIS_URL` set it runs on BullMQ; without it, it
 * falls back to an inline in-process pass (useful for local dev / a Redis-less
 * environment) so the pipeline is still exercisable.
 */

require('dotenv').config();

import { Queue, Worker, type Job } from 'bullmq';
import {
  createDefaultRegistry,
  HttpFetchRuntime,
  type ExternalListingRef,
  type FetchRuntime,
  type ProviderRegistry,
} from '@homiio/listing-providers';
import config from './config';
import database from './database/connection';
import { Logger } from './utils/logger';
import { IngestionService } from './services/ingestion/IngestionService';
import {
  QUEUE_NAMES,
  discoverJobId,
  fetchJobId,
  parseRedisConnection,
  type DiscoverJobData,
  type FetchJobData,
} from './services/ingestion/queues';

const logger = new Logger('ListingWorker');

/** Fetch-worker concurrency (source portals are rate-sensitive; keep it small). */
const FETCH_CONCURRENCY = parseInt(process.env.LISTING_FETCH_CONCURRENCY || '2', 10);

const registry: ProviderRegistry = createDefaultRegistry();
const runtime: FetchRuntime = new HttpFetchRuntime();
const ingestionService = new IngestionService();

/** Fetch + normalize a single listing ref and ingest the result. */
async function processFetchRef(ref: ExternalListingRef): Promise<void> {
  const provider = registry.get(ref.provider);
  const raw = await provider.fetch(ref, { runtime });
  const listing = provider.normalize(raw);
  await ingestionService.ingest(listing);
}

/** Enumerate a discover job's refs (BullMQ path enqueues; inline path ingests). */
async function collectDiscoverRefs(data: DiscoverJobData): Promise<ExternalListingRef[]> {
  const provider = registry.get(data.provider);
  const refs: ExternalListingRef[] = [];
  for await (const ref of provider.discover({
    provider: data.provider,
    market: data.market,
    city: data.city,
    bbox: data.bbox,
    limit: data.limit,
    runtime,
  })) {
    refs.push(ref);
  }
  return refs;
}

/** The discover scopes to enqueue on boot: one per (provider, market). */
function bootDiscoverJobs(): DiscoverJobData[] {
  return registry.all().flatMap((provider) =>
    provider.markets.map((market) => ({ provider: provider.id, market })),
  );
}

/** Run the whole pipeline inline (no Redis): discover → fetch → ingest. */
async function runInlinePass(): Promise<void> {
  logger.info('Running inline discovery pass (no REDIS_URL configured)');
  for (const data of bootDiscoverJobs()) {
    const refs = await collectDiscoverRefs(data);
    for (const ref of refs) {
      try {
        await processFetchRef(ref);
      } catch (error) {
        logger.error('Inline ingest failed for ref', {
          ref,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/** Wire the BullMQ queues + workers and return a graceful-shutdown closer. */
function startBullMq(): () => Promise<void> {
  const connection = parseRedisConnection(config.redis.url);
  const prefix = config.listingWorker.queuePrefix;

  const fetchQueue = new Queue<FetchJobData>(QUEUE_NAMES.fetch, { connection, prefix });

  const discoverWorker = new Worker<DiscoverJobData>(
    QUEUE_NAMES.discover,
    async (job: Job<DiscoverJobData>) => {
      const refs = await collectDiscoverRefs(job.data);
      for (const ref of refs) {
        await fetchQueue.add(QUEUE_NAMES.fetch, { ref }, { jobId: fetchJobId(ref) });
      }
      logger.info('Discover job enqueued fetch jobs', {
        provider: job.data.provider,
        market: job.data.market,
        count: refs.length,
      });
    },
    { connection, prefix, concurrency: 1 },
  );

  const fetchWorker = new Worker<FetchJobData>(
    QUEUE_NAMES.fetch,
    async (job: Job<FetchJobData>) => {
      await processFetchRef(job.data.ref);
    },
    { connection, prefix, concurrency: FETCH_CONCURRENCY },
  );

  for (const worker of [discoverWorker, fetchWorker]) {
    worker.on('failed', (job, error) => {
      logger.error('Listing job failed', { queue: worker.name, jobId: job?.id, error: error.message });
    });
  }

  const discoverQueue = new Queue<DiscoverJobData>(QUEUE_NAMES.discover, { connection, prefix });

  async function enqueueBootDiscovery(): Promise<void> {
    for (const data of bootDiscoverJobs()) {
      await discoverQueue.add(QUEUE_NAMES.discover, data, { jobId: discoverJobId(data) });
    }
    logger.info('Enqueued boot discovery jobs');
  }

  if (config.listingWorker.discoverOnBoot) {
    enqueueBootDiscovery().catch((error) => {
      logger.error('Failed to enqueue boot discovery', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return async () => {
    await Promise.all([discoverWorker.close(), fetchWorker.close()]);
    await Promise.all([discoverQueue.close(), fetchQueue.close()]);
  };
}

async function main(): Promise<void> {
  await database.connect();
  logger.info('Listing worker connected to database', {
    providers: registry.ids(),
    redis: config.listingWorker.redisConfigured,
  });

  let closer: (() => Promise<void>) | undefined;

  if (config.listingWorker.redisConfigured) {
    closer = startBullMq();
    logger.info('Listing worker started on BullMQ', { queues: Object.values(QUEUE_NAMES) });
  } else if (config.listingWorker.discoverOnBoot) {
    await runInlinePass();
    logger.info('Inline pass complete; no Redis configured, exiting');
    await database.disconnect?.();
    return;
  } else {
    logger.warn('No REDIS_URL and discoverOnBoot=false — worker idle. Set REDIS_URL to enable queues.');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down listing worker`);
    if (closer) await closer();
    await database.disconnect?.();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('Listing worker failed to start', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
