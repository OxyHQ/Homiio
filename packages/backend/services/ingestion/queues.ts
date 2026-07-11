/**
 * BullMQ queue wiring for listing ingestion.
 *
 * Two queues, following the plan:
 *   - `listing-discover`: a provider + market scope → enumerates listing refs.
 *   - `listing-fetch`:     one listing ref → fetch + normalize → ingest.
 *
 * Oxy/BullMQ conventions enforced here:
 *   - queue names and the key prefix contain NO ':' (BullMQ joins them with ':').
 *   - custom job / deduplication ids are sha256 hex (never raw values with ':').
 *   - the Redis connection is a plain OPTIONS object (not an ioredis instance)
 *     with `maxRetriesPerRequest: null`.
 */

import { createHash } from 'node:crypto';
import type { ConnectionOptions } from 'bullmq';
import type { ListingMarket, ProviderId } from '@homiio/shared-types';
import type { ExternalListingRef } from '@homiio/listing-providers';

/** Colon-free queue names (BullMQ prepends the prefix with a ':' itself). */
export const QUEUE_NAMES = {
  discover: 'listing-discover',
  fetch: 'listing-fetch',
} as const;

/** Payload of a `listing-discover` job. */
export interface DiscoverJobData {
  provider: ProviderId;
  market: ListingMarket;
  city?: string;
  bbox?: [number, number, number, number];
  limit?: number;
}

/** Payload of a `listing-fetch` job. */
export interface FetchJobData {
  ref: ExternalListingRef;
}

/** Hash an arbitrary key into colon-free sha256 hex for use as a BullMQ job id. */
export function jobIdFor(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/** Deterministic job id for a discover pass (dedupes identical scopes). */
export function discoverJobId(data: DiscoverJobData): string {
  return jobIdFor(['discover', data.provider, data.market, data.city ?? '']);
}

/** Deterministic job id for a fetch (dedupes by provider + sourceId). */
export function fetchJobId(ref: ExternalListingRef): string {
  return jobIdFor(['fetch', ref.provider, ref.sourceId]);
}

/* -------------------------------------------------------------------------- */
/* Round-robin fetch priority                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Big-volume ES portals emit thousands of fetch jobs per discover pass and are
 * browser/rate-limit heavy. They ride a LATER priority tier so the handful of
 * jobs from market-wide providers (immobilienscout24, immoweb, mercadolibre, …)
 * drain first — while still round-robining among themselves inside the tier.
 * Configurable: move a provider between tiers by editing this set.
 */
export const HIGH_VOLUME_PROVIDERS: ReadonlySet<string> = new Set([
  'fotocasa',
  'habitaclia',
  'pisos',
  'idealista',
]);

/**
 * Priority tier bases. BullMQ orders prioritised jobs by
 * `score = priority * 2^32 + insertionCounter` and pops the lowest, so a lower
 * priority number runs first and the normal tier (base 0) fully precedes the
 * high-volume tier. The gap MUST exceed {@link FETCH_RANK_CAP} so the two tiers
 * never overlap.
 */
const FETCH_TIER_NORMAL = 0;
const FETCH_TIER_HIGH_VOLUME = 1_000_000;

/**
 * Max round-robin rank honoured per discover batch. Clamps a pathological batch
 * so a job's priority can never approach BullMQ's `PRIORITY_LIMIT` (2^21) — the
 * high-volume tier tops out at `1_000_000 + 100_000 + 1`, comfortably below it.
 * Real batches (one provider/city's refs) sit far under this.
 */
export const FETCH_RANK_CAP = 100_000;

/** Base priority tier for a provider (normal vs high-volume). */
function fetchTierBase(provider: string): number {
  return HIGH_VOLUME_PROVIDERS.has(provider) ? FETCH_TIER_HIGH_VOLUME : FETCH_TIER_NORMAL;
}

/**
 * Round-robin fetch priority for the `rank`-th ref (0-based) of a provider's
 * discover batch.
 *
 * Every provider's rank-0 ref shares its tier's lowest priority, every rank-1
 * ref the next, and so on. Because rank restarts at 0 for each discover pass,
 * all providers stay aligned, so BullMQ interleaves them (A0,B0,C0,A1,B1,C1,…)
 * instead of draining one provider's whole backlog first — even though the
 * discover jobs that enqueued them ran at different times. A free-running
 * per-provider counter would NOT do this: its rank window drifts independently
 * per provider after the first pass, breaking the interleave.
 *
 * The `+ 1` keeps the value ≥ 1 so a fetch job never lands in BullMQ's
 * unprioritised `wait` lane, which is drained in full before ANY prioritised
 * job (`moveToActive` does `RPOPLPUSH wait` before `ZPOPMIN prioritized`).
 */
export function fetchPriorityFor(provider: string, rank: number): number {
  const clamped = Math.min(Math.max(Math.trunc(rank), 0), FETCH_RANK_CAP);
  return fetchTierBase(provider) + clamped + 1;
}

/**
 * Build a BullMQ Redis connection OPTIONS object from a `redis[s]://` URL. We
 * pass options (not an ioredis instance) so BullMQ owns the connection, and set
 * `maxRetriesPerRequest: null` as BullMQ requires for blocking commands.
 */
export function parseRedisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const isTls = parsed.protocol === 'rediss:';
  const db = parsed.pathname.replace(/^\//, '');
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: db ? parseInt(db, 10) : undefined,
    tls: isTls ? {} : undefined,
    maxRetriesPerRequest: null,
  };
  return connection;
}
