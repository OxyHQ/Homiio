/**
 * Privacy-safe observation of the geo gateway.
 *
 * ADR 0002 §8.2 lists where an exact coordinate may never go, and a log line is
 * on that list; the issue adds the query text itself, because a place search is
 * a record of where somebody is thinking of living. So this module is the ONE
 * place a geo request is described, and the shape it emits is the shape it is
 * allowed to emit.
 *
 * What is recorded: the operation, the LENGTH bucket of the query, the country
 * restriction, the requested types, the outcome, whether the cache served it,
 * which provider answered and how long it took.
 *
 * What is never recorded: the query text, any coordinate at any precision, a
 * display name, a `loc` token's id part, an IP, or anything derived from
 * `req.user`. A length bucket cannot be inverted into an address, which is the
 * property that makes the metric safe to keep and still useful for spotting a
 * provider going down.
 *
 * The rule generalises beyond this file: anything added here must survive the
 * question "could this line, or a pile of these lines, identify where somebody
 * lives or is looking?" — and a full query string plainly could.
 */

import { logger } from '../../middlewares/logging';

export type GeoOperation = 'search' | 'resolve' | 'reverse';

export type GeoOutcome =
  | 'ok'
  | 'empty'
  | 'not_found'
  | 'invalid_input'
  | 'rate_limited'
  | 'timeout'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'error';

/**
 * Query lengths as coarse buckets.
 *
 * An exact length is a surprisingly strong fingerprint when it travels beside a
 * country code and a timestamp; a bucket is enough to see "somebody is
 * hammering us with 2-character queries" without carrying that.
 */
export function queryLengthBucket(length: number): string {
  if (length <= 0) return '0';
  if (length <= 3) return '1-3';
  if (length <= 8) return '4-8';
  if (length <= 16) return '9-16';
  if (length <= 32) return '17-32';
  if (length <= 64) return '33-64';
  return '65+';
}

export interface GeoRequestObservation {
  readonly operation: GeoOperation;
  readonly outcome: GeoOutcome;
  readonly durationMs: number;
  /** Length of the user's query, bucketed. Absent for reverse and resolve. */
  readonly queryLength?: number;
  readonly countryCode?: string;
  readonly types?: readonly string[];
  /** Which provider answered. Absent when the cache did. */
  readonly providerId?: string;
  readonly cacheHit?: boolean;
  /** True when the preferred provider failed and a later one answered. */
  readonly degraded?: boolean;
  /** How many candidates were returned. A count, never the candidates. */
  readonly resultCount?: number;
  /** The `loc` token's KIND only (`city`, `bbox`, …), never its id. */
  readonly locKind?: string;
}

/**
 * Build the metric payload.
 *
 * Exported separately from {@link observeGeoRequest} so a test can assert on
 * the exact object that would be logged. Asserting on the built payload is what
 * makes "no address ever reaches a log line" checkable rather than a promise:
 * a test can feed a query containing a marker and assert the marker appears
 * nowhere in `JSON.stringify` of the result.
 */
export function buildGeoObservation(
  observation: GeoRequestObservation,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    operation: observation.operation,
    outcome: observation.outcome,
    durationMs: observation.durationMs,
  };
  if (observation.queryLength !== undefined) {
    payload.queryLengthBucket = queryLengthBucket(observation.queryLength);
  }
  if (observation.countryCode) payload.countryCode = observation.countryCode;
  if (observation.types?.length) payload.types = [...observation.types].sort().join(',');
  if (observation.providerId) payload.provider = observation.providerId;
  if (observation.cacheHit !== undefined) payload.cacheHit = observation.cacheHit;
  if (observation.degraded !== undefined) payload.degraded = observation.degraded;
  if (observation.resultCount !== undefined) payload.resultCount = observation.resultCount;
  if (observation.locKind) payload.locKind = observation.locKind;
  return payload;
}

export function observeGeoRequest(observation: GeoRequestObservation): void {
  const payload = buildGeoObservation(observation);
  if (observation.outcome === 'ok' || observation.outcome === 'empty') {
    logger.info('geo.request', payload);
    return;
  }
  logger.warn('geo.request', payload);
}
