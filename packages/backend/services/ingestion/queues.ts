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
  /**
   * Market the ref was discovered under, so the fetch exits from that market's
   * residential-proxy country (per-market geo). Optional: absent on jobs
   * enqueued before this field existed — the worker then derives the country
   * from a single-market provider or falls back to the global geo.
   */
  market?: ListingMarket;
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
 * Providers that emit large per-scope batches and are browser/rate-limit heavy.
 *
 * **RETAINED FOR DOCUMENTATION AND TESTS; NO LONGER A PRIORITY TIER.** See
 * {@link fetchPriorityFor} for what this set used to do and why it stopped.
 */
export const HIGH_VOLUME_PROVIDERS: ReadonlySet<string> = new Set([
  'fotocasa',
  'habitaclia',
  'pisos',
  'idealista',
]);

/**
 * THE TIER THAT USED TO LIVE HERE STARVED AN ENTIRE MARKET. Kept as a comment
 * because the reasoning that produced it was sound and the reasoning that
 * removes it is only visible next to it.
 *
 * `FETCH_TIER_HIGH_VOLUME = 1_000_000` put the ES portals in a band that the
 * normal band fully preceded: not "later", but "not until the normal tier is
 * EMPTY". That was safe under its stated premise — that market-wide providers
 * contribute "the handful of jobs" the old comment described.
 *
 * The premise is false. Measured in production on 2026-09-20: a single discover
 * pass enqueued 1,500 refs from immobilienscout24 and 1,021 from kleinanzeigen
 * — 2,521 normal-tier jobs that every fotocasa, pisos, habitaclia and idealista
 * fetch had to wait behind, with the next pass arriving every 6 hours to refill
 * the band. The result was a database holding 481 German listings and 31
 * Spanish ones: Berlin 304, Hamburg 177, Barcelona 3. Spain had not stopped
 * being discovered; its fetches simply never reached the front of the queue.
 *
 * Round-robin rank alone now carries the fairness, exactly as it already does
 * for discover (see {@link discoverPriorityFor}, which faced the mirror image of
 * this bug and resolved it the same way). No band can precede another, so no
 * provider's backlog can hold another provider's first job hostage.
 *
 * WHAT THIS DOES NOT CLAIM: that the resulting share is correct. A market-wide
 * provider discovers ONE scope of 1,500 refs while the ES portals discover 68
 * cities each, so per-scope round-robin now favours the ES side. That is a
 * deliberate trade of a known starvation for a measurable imbalance — and the
 * `Oxy/Homiio ListingsIngested` alarm is per-market precisely so the imbalance
 * is observable instead of inferred. Tune from that metric, not from taste.
 */
const FETCH_TIER_NORMAL = 0;

/**
 * Max round-robin rank honoured per discover batch. Clamps a pathological batch
 * so a job's priority can never approach BullMQ's `PRIORITY_LIMIT` (2^21) — the
 * high-volume tier tops out at `1_000_000 + 100_000 + 1`, comfortably below it.
 * Real batches (one provider/city's refs) sit far under this.
 */
export const FETCH_RANK_CAP = 100_000;

/**
 * Round-robin fetch priority for the `rank`-th ref (0-based) of a provider's
 * discover batch.
 *
 * Every provider's rank-0 ref shares the lowest priority, every rank-1 ref the
 * next, and so on — across ALL providers, with no band preceding another. Because rank restarts at 0 for each discover pass,
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
  return FETCH_TIER_NORMAL + clamped + 1;
}

/**
 * Round-robin priority for the `rank`-th discover scope of a provider in the
 * interleaved boot list — `rank` is the scope's per-provider index (its city
 * index for browser-heavy ES portals that discover one job per city, else 0 for
 * a single market-wide scope).
 *
 * SINGLE tier by design — unlike {@link fetchPriorityFor}, discover does NOT sink
 * the big-volume ES portals into a later tier. The requirement is that every
 * provider's city-0 runs before ANY provider's city-1, so the ES portals share
 * round 0 with the small providers and START producing fetch refs immediately;
 * their remaining ~180 cities merely fill later rounds instead of monopolising
 * the queue head (the observed bug: only pisos/fotocasa ever discovered while 11
 * market-wide providers with 2-3 scopes each starved behind the ES city flood).
 * A later ES tier would violate "city-0 before any city-1" and delay the largest
 * inventory source, so round-robin rank alone carries the fairness here.
 *
 * `provider` is kept for signature parity with {@link fetchPriorityFor} and a
 * possible future per-provider discover tier. The `+ 1` and {@link FETCH_RANK_CAP}
 * clamp (shared bound; discover ranks sit far below it) work exactly as in fetch:
 * priority stays ≥ 1 (out of BullMQ's unprioritised `wait` lane) and well under
 * `PRIORITY_LIMIT`.
 */
export function discoverPriorityFor(provider: string, rank: number): number {
  return Math.min(Math.max(Math.trunc(rank), 0), FETCH_RANK_CAP) + 1;
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
