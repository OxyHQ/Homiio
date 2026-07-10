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
