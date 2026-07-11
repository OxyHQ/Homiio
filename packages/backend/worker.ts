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

import { Queue, Worker, UnrecoverableError, type Job, type Queue as BullQueue } from 'bullmq';
import {
  createDefaultRegistry,
  createListingFetchRuntimeFromEnv,
  BluegroundPartnerListingError,
  ListingValidationError,
  NonHousingListingError,
  fotocasaCitiesFromEnv,
  habitacliaCitiesFromEnv,
  idealistaCitiesFromEnv,
  pisosCitiesFromEnv,
  type ExternalListingRef,
  type FetchRuntime,
  type ListingFetchRuntimeHandle,
  type ProviderRegistry,
} from '@homiio/listing-providers';
import { PropertyStatus, type ProviderId } from '@homiio/shared-types';
import config from './config';
import database from './database/connection';
import { Logger } from './utils/logger';
import { Property } from './models';
import { IngestionService, IngestionValidationError } from './services/ingestion/IngestionService';
import {
  QUEUE_NAMES,
  discoverJobId,
  discoverPriorityFor,
  fetchJobId,
  fetchPriorityFor,
  parseRedisConnection,
  type DiscoverJobData,
  type FetchJobData,
} from './services/ingestion/queues';

const logger = new Logger('ListingWorker');

/**
 * Fetch-worker concurrency. The HTTP tier fetches through the residential proxy
 * WITHOUT a sticky session (fetchHttp passes no sessionId), so Evomi rotates the
 * exit IP per request — a higher fan-out no longer trips a single IP's rate
 * limit. Tune via LISTING_FETCH_CONCURRENCY.
 */
const FETCH_CONCURRENCY = parseInt(process.env.LISTING_FETCH_CONCURRENCY || '6', 10);

/**
 * Discover-worker concurrency. With ~15 providers and per-city scopes for the
 * browser-heavy ES portals, a single concurrent discover let a handful of
 * per-city scopes (pisos/fotocasa/habitaclia) monopolise the queue for hours
 * while market-wide providers (DE/ML/otodom/…) never got a turn. Run a few in
 * parallel; the Playwright pool still caps its own concurrency, so browser
 * scopes serialise there while HTTP-first scopes proceed.
 */
const DISCOVER_CONCURRENCY = parseInt(process.env.LISTING_DISCOVER_CONCURRENCY || '3', 10);

/** Discover jobs may hold a browser session across many cities — match worker lockDuration. */
const DISCOVER_LOCK_MS = 600_000;

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
  if (!registry.has(ref.provider)) {
    // A queued job for a provider that is no longer registered (disabled via env,
    // renamed, or removed) can never succeed. Fail it permanently instead of
    // burning all 3 attempts + exponential backoff — that churn produced
    // thousands of pointless "No provider registered" retries in prod.
    throw new UnrecoverableError(`No provider registered for id "${ref.provider}"`);
  }
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
  if (!registry.has(data.provider)) {
    throw new UnrecoverableError(`No provider registered for id "${data.provider}"`);
  }
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

/** Providers whose discover pass warms a browser session per city — one job per city. */
function discoverCitiesForProvider(providerId: string): string[] | undefined {
  if (providerId === 'fotocasa') return fotocasaCitiesFromEnv();
  if (providerId === 'habitaclia') return habitacliaCitiesFromEnv();
  if (providerId === 'idealista') return idealistaCitiesFromEnv();
  if (providerId === 'pisos') return pisosCitiesFromEnv();
  return undefined;
}

/**
 * A discover scope plus its round-robin `rank` — the scope's per-provider index
 * (city index for browser-heavy ES portals, else 0). {@link discoverPriorityFor}
 * turns rank into a priority so every provider's city-0 runs before any
 * provider's city-1.
 */
interface BootDiscoverScope {
  data: DiscoverJobData;
  rank: number;
}

/** The discover scopes to enqueue on boot: one per (provider, market), or per-city for browser-heavy portals. */
function bootDiscoverJobs(): BootDiscoverScope[] {
  // One scope list per provider (per-city for browser-heavy portals, else market-wide).
  const perProvider = registry.all().map((provider) =>
    provider.markets.flatMap((market) => {
      const perCity = discoverCitiesForProvider(provider.id);
      if (perCity) {
        return perCity.map((city) => ({ provider: provider.id, market, city }));
      }
      return [{ provider: provider.id, market }];
    }),
  );
  // Round-robin interleave: scope[0] of every provider, then scope[1], … A single
  // high-scope portal (fotocasa/habitaclia = ~68 cities each) can no longer
  // monopolise the queue head — every provider gets a discover turn in the first
  // round, and consecutive jobs hit different portals (gentler on each rate limit).
  // `i` is each scope's per-provider rank, which discoverPriorityFor uses so the
  // FIFO interleave is also enforced by BullMQ priority (survives jobId dedup and
  // recurring re-enqueue, which a plain FIFO order does not).
  const interleaved: BootDiscoverScope[] = [];
  const maxLen = perProvider.reduce((max, list) => Math.max(max, list.length), 0);
  for (let i = 0; i < maxLen; i += 1) {
    for (const list of perProvider) {
      const scope = list[i];
      if (scope) interleaved.push({ data: scope, rank: i });
    }
  }
  return interleaved;
}

/** Run the whole pipeline inline (no Redis): discover → fetch → ingest. */
async function runInlinePass(): Promise<void> {
  logger.info('Running inline discovery pass (no REDIS_URL configured)');
  for (const { data } of bootDiscoverJobs()) {
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

/** Log queue depth so deploys show whether discover/fetch are backed up. */
async function logQueueCounts(
  discoverQueue: BullQueue<DiscoverJobData>,
  fetchQueue: BullQueue<FetchJobData>,
): Promise<void> {
  const [discoverCounts, fetchCounts] = await Promise.all([
    discoverQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    fetchQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
  ]);
  logger.info('Listing queue counts', {
    discover: discoverCounts,
    fetch: fetchCounts,
  });
}

/**
 * A redeployed ECS task can leave a discover job "active" in Valkey when the
 * prior worker died mid-pass. Those ghost locks consume discover slots until
 * stall recovery — clear them on boot.
 */
async function removeDiscoverJobOrForceFail(
  job: Job<DiscoverJobData>,
  reason: string,
): Promise<boolean> {
  try {
    await job.remove();
    logger.warn('Removed discover job', {
      jobId: job.id,
      provider: job.data.provider,
      city: job.data.city,
      reason,
    });
    return true;
  } catch (removeError) {
    try {
      await job.moveToFailed(new Error(reason), '0', true);
      logger.warn('Force-failed locked discover job', {
        jobId: job.id,
        provider: job.data.provider,
        city: job.data.city,
        reason,
      });
      return true;
    } catch (failError) {
      logger.warn('Could not remove or fail discover job', {
        jobId: job.id,
        provider: job.data.provider,
        city: job.data.city,
        removeError: removeError instanceof Error ? removeError.message : String(removeError),
        failError: failError instanceof Error ? failError.message : String(failError),
      });
      return false;
    }
  }
}

/** Drop pre per-city discover scopes that can block the queue for hours. */
async function purgeLegacyMarketWideDiscoverJobs(
  discoverQueue: BullQueue<DiscoverJobData>,
  provider: ProviderId,
): Promise<void> {
  const legacyScope: DiscoverJobData = { provider, market: 'ES' };
  const legacyId = discoverJobId(legacyScope);
  const legacyRepeatKey = `repeat-${legacyId}`;

  try {
    const removed = await discoverQueue.removeRepeatableByKey(legacyRepeatKey);
    if (removed) {
      logger.warn('Removed legacy repeat scheduler', { provider, legacyRepeatKey });
    }
  } catch (error) {
    logger.warn('Could not remove legacy repeat scheduler', {
      provider,
      legacyRepeatKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const legacyJob = await discoverQueue.getJob(legacyId);
  if (legacyJob) {
    await removeDiscoverJobOrForceFail(legacyJob, `legacy market-wide ${provider} discover`);
  }

  const activeJobs = await discoverQueue.getJobs(['active'], 0, 50);
  for (const job of activeJobs) {
    if (job.data.provider !== provider || job.data.city) continue;
    await removeDiscoverJobOrForceFail(job, `superseded active ${provider} discover scope`);
  }

  const candidates = await discoverQueue.getJobs(['waiting', 'delayed'], 0, 200);
  for (const job of candidates) {
    if (job.data.provider !== provider || job.data.city) continue;
    await removeDiscoverJobOrForceFail(job, `superseded ${provider} discover scope`);
  }
}

/** Drop pre per-city discover scopes that can block the queue for hours. */
async function purgeLegacyPerCityDiscoverJobs(discoverQueue: BullQueue<DiscoverJobData>): Promise<void> {
  await purgeLegacyMarketWideDiscoverJobs(discoverQueue, 'fotocasa');
  for (const provider of ['habitaclia', 'idealista', 'pisos'] as const satisfies readonly ProviderId[]) {
    await purgeLegacyMarketWideDiscoverJobs(discoverQueue, provider);
  }
}

async function releaseStaleActiveDiscoverJobs(discoverQueue: BullQueue<DiscoverJobData>): Promise<number> {
  const activeJobs = await discoverQueue.getJobs(['active'], 0, 50);
  const staleBefore = Date.now() - DISCOVER_LOCK_MS;
  let released = 0;
  for (const job of activeJobs) {
    const processedOn = job.processedOn ?? 0;
    if (processedOn > staleBefore) continue;
    const removed = await removeDiscoverJobOrForceFail(job, 'stale active discover after redeploy');
    if (removed) released += 1;
  }
  if (released > 0) {
    logger.warn('Released stale active discover jobs after redeploy', { released });
  }
  return released;
}

/** Wire the BullMQ queues + workers and return a graceful-shutdown closer. */
async function startBullMq(): Promise<() => Promise<void>> {
  const connection = parseRedisConnection(config.redis.url);
  const prefix = config.listingWorker.queuePrefix;

  const fetchQueue = new Queue<FetchJobData>(QUEUE_NAMES.fetch, { connection, prefix });
  const discoverQueue = new Queue<DiscoverJobData>(QUEUE_NAMES.discover, { connection, prefix });

  // Purge ghost/scoped jobs before the discover worker can claim them.
  await purgeLegacyPerCityDiscoverJobs(discoverQueue);
  await releaseStaleActiveDiscoverJobs(discoverQueue);

  const discoverWorker = new Worker<DiscoverJobData>(
    QUEUE_NAMES.discover,
    async (job: Job<DiscoverJobData>) => {
      logger.info('Discover job started', {
        provider: job.data.provider,
        market: job.data.market,
        city: job.data.city,
      });
      const refs = await collectDiscoverRefs(job.data);
      // `rank` is the ref's 0-based position in THIS discover batch. It restarts
      // at 0 every pass, so every provider's rank-0 job shares the lowest
      // priority in its tier and BullMQ interleaves providers round-robin rather
      // than draining one provider's whole backlog first. See fetchPriorityFor.
      for (const [rank, ref] of refs.entries()) {
        const jobId = fetchJobId(ref);
        const existingFetch = await fetchQueue.getJob(jobId);
        if (existingFetch) {
          const state = await existingFetch.getState();
          if (state === 'completed' || state === 'failed') {
            await existingFetch.remove();
          }
        }
        await fetchQueue.add(QUEUE_NAMES.fetch, { ref }, {
          jobId,
          priority: fetchPriorityFor(ref.provider, rank),
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        });
      }
      logger.info('Discover job enqueued fetch jobs', {
        provider: job.data.provider,
        market: job.data.market,
        city: job.data.city,
        count: refs.length,
      });
    },
    { connection, prefix, concurrency: DISCOVER_CONCURRENCY, lockDuration: DISCOVER_LOCK_MS },
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

  async function enqueueBootDiscovery(): Promise<void> {
    await logQueueCounts(discoverQueue, fetchQueue);
    for (const { data, rank } of bootDiscoverJobs()) {
      const jobId = discoverJobId(data);
      // Boot uses deterministic ids for dedup. Remove only a prior completed/failed
      // job so a redeploy actually re-runs discover (otherwise BullMQ keeps the
      // stale failure from an older image, e.g. pre-HTML-scrape Blueground).
      //
      // Do NOT remove a job still `waiting`/`delayed`: with ~290 per-city scopes,
      // discover concurrency 1, and frequent redeploys, removing + re-adding every
      // boot reshuffles the queue so a short-lived worker only ever drains the
      // front — later scopes (e.g. habitaclia) starve indefinitely. Leaving
      // pending jobs in place (the `add` is a no-op on an existing id) lets the
      // worker advance through the backlog across restarts instead of resetting it.
      const existing = await discoverQueue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'completed' || state === 'failed') {
          await existing.remove();
        }
      }
      // Round-robin priority so every provider's city-0 outranks any provider's
      // city-1 — the ES per-city flood no longer starves the market-wide
      // providers' 2-3 scopes. (New enqueues only; the stale priority-0 backlog
      // is purged post-deploy.)
      await discoverQueue.add(QUEUE_NAMES.discover, data, {
        jobId,
        priority: discoverPriorityFor(data.provider, rank),
      });
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

  const discoverIntervalHours = config.listingWorker.discoverIntervalHours;
  if (discoverIntervalHours > 0) {
    const intervalMs = discoverIntervalHours * 60 * 60 * 1000;
    const recurringScopes = bootDiscoverJobs();
    void (async () => {
      for (const { data, rank } of recurringScopes) {
        await discoverQueue.add(QUEUE_NAMES.discover, data, {
          priority: discoverPriorityFor(data.provider, rank),
          repeat: { key: `repeat-${discoverJobId(data)}`, every: intervalMs },
        });
      }
      logger.info('Scheduled recurring discovery jobs', {
        intervalHours: discoverIntervalHours,
        scopes: recurringScopes.length,
      });
    })().catch((error) => {
      logger.error('Failed to schedule recurring discovery', {
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
    closer = await startBullMq();
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
