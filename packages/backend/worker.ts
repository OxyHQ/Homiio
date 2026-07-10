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
  createListingFetchRuntimeFromEnv,
  BluegroundPartnerListingError,
  ListingValidationError,
  NonHousingListingError,
  type ExternalListingRef,
  type FetchRuntime,
  type ListingFetchRuntimeHandle,
  type ProviderRegistry,
} from '@homiio/listing-providers';
import { PropertyStatus } from '@homiio/shared-types';
import config from './config';
import database from './database/connection';
import { Logger } from './utils/logger';
import { Property } from './models';
import { IngestionService, IngestionValidationError } from './services/ingestion/IngestionService';
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
const ingestionService = new IngestionService();

/**
 * Shared fetch runtime (HTTP + optional browser/managed escalation tiers),
 * assembled from env in {@link main} before any job runs. The browser tier is
 * gated on `LISTING_BROWSER_ENABLED` + an installed Playwright; the managed tier
 * on `LISTING_MANAGED_FETCH_URL`. Absent tiers are skipped by the shared ladder.
 */
let runtimeHandle: ListingFetchRuntimeHandle;
let runtime: FetchRuntime;

/** Soft-remove a previously ingested external listing that must no longer publish. */
async function expireExternalListing(source: string, sourceId: string, reason: string): Promise<void> {
  const result = await Property.updateOne(
    { source, sourceId, isExternal: true },
    { $set: { status: PropertyStatus.ARCHIVED, expiresAt: new Date() } },
  );
  if (result.modifiedCount > 0 || result.matchedCount > 0) {
    logger.info('Expired external listing after skip', { source, sourceId, reason, matched: result.matchedCount });
  }
}

/** Fetch + normalize a single listing ref and ingest the result. */
async function processFetchRef(ref: ExternalListingRef): Promise<void> {
  const provider = registry.get(ref.provider);
  try {
    const raw = await provider.fetch(ref, { runtime });
    const listing = provider.normalize(raw);
    await ingestionService.ingest(listing);
  } catch (error) {
    if (error instanceof BluegroundPartnerListingError) {
      logger.info('Skipped Blueground partner listing', {
        sourceId: error.sourceId,
        reason: error.reason,
      });
      await expireExternalListing(ref.provider, ref.sourceId, error.reason);
      return;
    }
    if (error instanceof NonHousingListingError) {
      logger.info('Skipped non-housing listing', {
        provider: error.provider,
        sourceId: error.sourceId,
        reason: error.reason,
      });
      return;
    }
    if (error instanceof ListingValidationError) {
      logger.info('Skipped listing (validation)', {
        source: error.source,
        sourceId: error.sourceId,
        reason: error.reason,
      });
      await expireExternalListing(error.source, error.sourceId, error.reason);
      return;
    }
    if (error instanceof IngestionValidationError) {
      logger.info('Skipped listing (ingest validation)', {
        provider: ref.provider,
        sourceId: ref.sourceId,
        reason: error.message,
      });
      return;
    }
    throw error;
  }
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
        const jobId = fetchJobId(ref);
        const existingFetch = await fetchQueue.getJob(jobId);
        if (existingFetch) {
          const state = await existingFetch.getState();
          if (state === 'completed' || state === 'failed') {
            await existingFetch.remove();
          }
        }
        await fetchQueue.add(QUEUE_NAMES.fetch, { ref }, { jobId });
      }
      logger.info('Discover job enqueued fetch jobs', {
        provider: job.data.provider,
        market: job.data.market,
        count: refs.length,
      });
    },
    { connection, prefix, concurrency: 1, lockDuration: 600_000 },
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
      const jobId = discoverJobId(data);
      // Boot uses deterministic ids for dedup; remove a prior completed/failed
      // job so a redeploy actually re-runs discover (otherwise BullMQ keeps the
      // stale failure from an older image, e.g. pre-HTML-scrape Blueground).
      const existing = await discoverQueue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'completed' || state === 'failed' || state === 'waiting' || state === 'delayed') {
          await existing.remove();
        }
      }
      await discoverQueue.add(QUEUE_NAMES.discover, data, { jobId });
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
  runtimeHandle = await createListingFetchRuntimeFromEnv({
    onLog: (message) => logger.warn(message),
  });
  runtime = runtimeHandle.runtime;
  logger.info('Listing worker connected to database', {
    providers: registry.ids(),
    redis: config.listingWorker.redisConfigured,
    browserTier: Boolean(runtime.fetchViaBrowser),
    managedTier: Boolean(runtime.fetchViaManaged),
  });

  let closer: (() => Promise<void>) | undefined;

  if (config.listingWorker.redisConfigured) {
    closer = startBullMq();
    logger.info('Listing worker started on BullMQ', { queues: Object.values(QUEUE_NAMES) });
  } else if (config.listingWorker.discoverOnBoot) {
    await runInlinePass();
    logger.info('Inline pass complete; no Redis configured, exiting');
    await runtimeHandle.shutdown();
    await database.disconnect?.();
    return;
  } else {
    logger.warn('No REDIS_URL and discoverOnBoot=false — worker idle. Set REDIS_URL to enable queues.');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down listing worker`);
    if (closer) await closer();
    await runtimeHandle.shutdown();
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
