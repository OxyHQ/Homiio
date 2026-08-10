/**
 * The emitter every caller uses, on the client and on the server alike.
 *
 * Three properties it is built around, all of them requirements from the issue
 * rather than preferences:
 *
 *   1. **It cannot block the action it observes.** `emit` is synchronous,
 *      returns a status and never throws — not for a malformed payload, not for
 *      a transport that rejects, not for a transport that throws outright. A
 *      search must still run when telemetry is broken.
 *   2. **Everything goes through `redactObservabilityEvent`.** There is no
 *      second path to the transport, which is what makes the "inspect the final
 *      payload" tests meaningful: what the transport receives IS what would
 *      leave the process.
 *   3. **Sampling is applied AFTER redaction, never before.** A dropped or
 *      refused event is a defect signal, and sampling it away would hide the
 *      one class of event nobody may lose. Refusals are always counted and
 *      always reported to `onRefused`; only successful events are sampled.
 *
 * The transport is injected. In a test it is a capturing array; on the server
 * it is the structured logger; on the client it is a batched POST to Homiio's
 * own ingest route. No third-party SDK is involved anywhere in this pipeline.
 */

import {
  OBSERVABILITY_SCHEMA_VERSION,
  type ObservabilityEvent,
  type ObservabilityEventName,
  type ObservabilityPayloads,
  type ObservabilitySurface,
} from './schema';
import {
  redactObservabilityEvent,
  type ObservabilityViolation,
  type ObservabilityViolationCode,
} from './redaction';

/** Where a redacted event goes. Must not throw; the emitter guards it anyway. */
export type ObservabilityTransport = (event: ObservabilityEvent) => void;

export interface ObservabilitySamplingConfig {
  /** Probability in [0, 1] applied to any event with no per-event override. */
  readonly default: number;
  readonly perEvent?: Partial<Record<ObservabilityEventName, number>>;
}

export interface ObservabilityEmitterConfig {
  readonly surface: ObservabilitySurface;
  readonly transport: ObservabilityTransport;
  /** Omitted means "keep everything" — the right default for a low-volume vocabulary. */
  readonly sampling?: ObservabilitySamplingConfig;
  /** Injected so a test can pin sampling decisions. Defaults to `Math.random`. */
  readonly random?: () => number;
  /** Injected so a test can pin `occurredAt`. Defaults to `Date.now`. */
  readonly now?: () => number;
  /**
   * Called for every refused event and every dropped field. Receives field
   * NAMES and codes only — never values. Wire it to a log line: "events
   * blocked or redacted" is one of the metrics this pipeline owes.
   */
  readonly onRefused?: (
    eventName: ObservabilityEventName | null,
    violations: readonly ObservabilityViolation[],
  ) => void;
  /**
   * Called when the transport throws. Optional; the failure is also visible in
   * `stats()` and in the returned status, so it is observable either way and
   * never silently swallowed.
   */
  readonly onTransportError?: (error: unknown) => void;
}

export type ObservabilityEmitStatus =
  | 'emitted'
  | 'sampled_out'
  | 'refused'
  | 'transport_error';

export interface ObservabilityEmitResult {
  readonly status: ObservabilityEmitStatus;
  readonly violations: readonly ObservabilityViolation[];
}

export interface ObservabilityStats {
  readonly emitted: number;
  readonly sampledOut: number;
  readonly refused: number;
  readonly transportErrors: number;
  /** Count per violation code, across refusals AND dropped-but-emitted fields. */
  readonly violationsByCode: Readonly<Partial<Record<ObservabilityViolationCode, number>>>;
}

/**
 * Fields a caller supplies: the event's own payload, plus the rotating session
 * reference. `schemaVersion`, `occurredAt` and `surface` are stamped by the
 * emitter and are not the caller's to set.
 */
export type ObservabilityEmitInput<E extends ObservabilityEventName> =
  ObservabilityPayloads[E] & { readonly sessionId?: string };

export interface ObservabilityEmitter {
  emit<E extends ObservabilityEventName>(
    event: E,
    fields: ObservabilityEmitInput<E>,
  ): ObservabilityEmitResult;
  stats(): ObservabilityStats;
}

export function createObservabilityEmitter(
  config: ObservabilityEmitterConfig,
): ObservabilityEmitter {
  const now = config.now ?? Date.now;
  const random = config.random ?? Math.random;

  let emitted = 0;
  let sampledOut = 0;
  let refused = 0;
  let transportErrors = 0;
  const violationsByCode: Partial<Record<ObservabilityViolationCode, number>> = {};

  const record = (violations: readonly ObservabilityViolation[]): void => {
    for (const violation of violations) {
      violationsByCode[violation.code] = (violationsByCode[violation.code] ?? 0) + 1;
    }
  };

  const keep = (event: ObservabilityEventName): boolean => {
    const sampling = config.sampling;
    if (sampling === undefined) return true;
    const rate = sampling.perEvent?.[event] ?? sampling.default;
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    return random() < rate;
  };

  return {
    emit(event, fields) {
      // The caller's object is never mutated, and the stamped fields go LAST so
      // a caller cannot override the clock, the surface or the version.
      const candidate = {
        ...fields,
        event,
        schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
        occurredAt: now(),
        surface: config.surface,
      };

      const result = redactObservabilityEvent(candidate);
      record(result.violations);

      if (result.status === 'refused') {
        refused += 1;
        config.onRefused?.(result.eventName, result.violations);
        return { status: 'refused', violations: result.violations };
      }

      if (result.violations.length > 0) {
        // Emitted, but with fields removed. Still a defect worth reporting:
        // a caller passing an undeclared field is usually a caller that thinks
        // it is passing something useful.
        config.onRefused?.(result.eventName, result.violations);
      }

      if (!keep(result.eventName)) {
        sampledOut += 1;
        return { status: 'sampled_out', violations: result.violations };
      }

      try {
        config.transport(result.event);
      } catch (error) {
        transportErrors += 1;
        config.onTransportError?.(error);
        return { status: 'transport_error', violations: result.violations };
      }

      emitted += 1;
      return { status: 'emitted', violations: result.violations };
    },

    stats() {
      return {
        emitted,
        sampledOut,
        refused,
        transportErrors,
        violationsByCode: { ...violationsByCode },
      };
    },
  };
}
