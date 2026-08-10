/**
 * Homiio's own observability sink. No third-party SDK is involved, here or
 * anywhere in this pipeline — the issue forbids adding one without an explicit
 * privacy review, and nothing in the repository sends product telemetry to a
 * vendor today (`grep -i posthog|mixpanel|amplitude|@segment/` over the tracked
 * tree returns nothing, and `@bitdrift/react-native` appears only as an Expo
 * config-plugin entry with no JS import).
 *
 * The sink is the structured logger, and that is a deliberate ceiling rather
 * than a placeholder. A table would make this a business-intelligence system,
 * which the issue puts explicitly out of scope; a log line is queryable by the
 * same tooling that already reads this service, and RETENTION becomes the log
 * group's retention — one setting, owned by `oxy-infra`, rather than a
 * per-event policy nobody maintains.
 *
 * TWO ENTRY POINTS, AND THEY ARE NOT INTERCHANGEABLE
 * --------------------------------------------------
 *   - `serverObservability()` emits events this process ORIGINATES. It stamps
 *     `surface: 'server'` and its own clock.
 *   - `ingestObservabilityEvents()` accepts events a CLIENT originated. It must
 *     preserve the client's `surface` and `occurredAt` — a phone's event
 *     relabelled `server` is a lie about where it happened — so it redacts
 *     without re-stamping, and does not sample (the client already did).
 *
 * Both go through `redactObservabilityEvent`. The client redacting first is not
 * a reason for the server to trust the result: an old build, a modified build
 * or something that is not our client at all reaches the same route.
 */

import {
  createObservabilityEmitter,
  redactObservabilityEvent,
  type ObservabilityEmitter,
  type ObservabilityEvent,
  type ObservabilityEventName,
  type ObservabilityTransport,
  type ObservabilityViolation,
  type ObservabilityViolationCode,
} from '@homiio/shared-types';

import config from '../config';
import { logger } from '../middlewares/logging';

/** The log message every observability line carries, so one query finds them all. */
export const OBSERVABILITY_LOG_MESSAGE = 'observability_event';
/** And the one every refusal carries. Field names and codes only, never values. */
export const OBSERVABILITY_REFUSED_LOG_MESSAGE = 'observability_event_refused';

/**
 * The production transport: one structured log line per event.
 *
 * `logger.info` spreads its meta into the entry, so every field of the event
 * lands at the top level of the line and is directly queryable.
 */
export function createLoggerTransport(): ObservabilityTransport {
  return (event: ObservabilityEvent): void => {
    logger.info(OBSERVABILITY_LOG_MESSAGE, { ...event });
  };
}

function logRefusal(
  eventName: ObservabilityEventName | null,
  violations: readonly ObservabilityViolation[],
): void {
  logger.warn(OBSERVABILITY_REFUSED_LOG_MESSAGE, {
    observedEvent: eventName ?? 'unknown',
    // Names and codes. The value that caused the refusal is exactly what must
    // not reach a log line — that is what the refusal prevented.
    violations: violations.map((violation) => `${violation.field}:${violation.code}`),
  });
}

/**
 * A transport that discards.
 *
 * Used when `config.observability.enabled` is false, which is the default in
 * every environment. Callers still run the full redaction path, so a payload
 * defect is caught in development and in CI whether or not anything is being
 * recorded — an event pipeline whose validation only runs when it is switched
 * on would be first exercised in production.
 */
const discardingTransport: ObservabilityTransport = () => {};

let emitter: ObservabilityEmitter | null = null;

/**
 * The process-wide emitter for server-originated events.
 *
 * Built lazily so that reading `config` at import time cannot reorder against
 * the dotenv load, and memoised so `stats()` accumulates across the process.
 */
export function serverObservability(): ObservabilityEmitter {
  if (emitter === null) {
    emitter = createObservabilityEmitter({
      surface: 'server',
      transport: config.observability.enabled ? createLoggerTransport() : discardingTransport,
      sampling: { default: config.observability.sampleRate },
      onRefused: logRefusal,
      onTransportError: (error: unknown) => {
        logger.error('observability_transport_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }
  return emitter;
}

/** Test seam: drop the memoised emitter so a test can rebuild it under new config. */
export function resetServerObservability(): void {
  emitter = null;
}

export interface ObservabilityIngestOutcome {
  readonly accepted: number;
  readonly refused: number;
  readonly overflowed: number;
  readonly violationsByCode: Readonly<Partial<Record<ObservabilityViolationCode, number>>>;
}

export interface ObservabilityIngestOptions {
  /** Where accepted events go. Injected so a test can capture the FINAL payload. */
  readonly transport: ObservabilityTransport;
  readonly maxEvents: number;
  readonly onRefused?: (
    eventName: ObservabilityEventName | null,
    violations: readonly ObservabilityViolation[],
  ) => void;
}

/**
 * Redact and forward a batch of client-originated events.
 *
 * Never throws, for any input. The caller is an HTTP handler whose only correct
 * response to a broken telemetry payload is to accept the request and record
 * that it refused the contents — a 500 here would teach a client to retry, and
 * a retry loop driven by telemetry is a self-inflicted outage.
 */
export function ingestObservabilityEvents(
  input: unknown,
  options: ObservabilityIngestOptions,
): ObservabilityIngestOutcome {
  const batch = Array.isArray(input) ? input : [];
  const considered = batch.slice(0, options.maxEvents);
  const overflowed = batch.length - considered.length;

  let accepted = 0;
  let refused = 0;
  const violationsByCode: Partial<Record<ObservabilityViolationCode, number>> = {};

  for (const raw of considered) {
    const result = redactObservabilityEvent(raw);
    for (const violation of result.violations) {
      violationsByCode[violation.code] = (violationsByCode[violation.code] ?? 0) + 1;
    }

    if (result.status === 'refused') {
      refused += 1;
      options.onRefused?.(result.eventName, result.violations);
      continue;
    }

    if (result.violations.length > 0) {
      options.onRefused?.(result.eventName, result.violations);
    }

    try {
      options.transport(result.event);
      accepted += 1;
    } catch (error) {
      refused += 1;
      logger.error('observability_transport_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { accepted, refused, overflowed, violationsByCode };
}

/** The options the HTTP handler uses, split out so a test can assert them. */
export function defaultIngestOptions(): ObservabilityIngestOptions {
  return {
    transport: config.observability.enabled ? createLoggerTransport() : discardingTransport,
    maxEvents: config.observability.maxEventsPerRequest,
    onRefused: logRefusal,
  };
}
