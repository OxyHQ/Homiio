/**
 * Per-provider observability.
 *
 * The shared runtime records ONE {@link ProviderMetricEvent} per fetch attempt
 * (per strategy), tagged with the outcome the strategy ladder classified:
 * `success` / `forbidden` (403) / `challenge` (CAPTCHA/anti-bot) / `error`
 * (network/timeout). Providers read a rolling {@link ProviderMetricsSnapshot}
 * to derive their `health()`.
 *
 * Two concerns, one object: {@link InMemoryProviderMetrics} is both a
 * {@link ProviderMetricsSink} (the runtime writes to it) and a
 * {@link ProviderMetricsReader} (providers read from it). An optional `onEvent`
 * callback bridges each event to the host's structured logger without coupling
 * this package to a concrete logger.
 */

import type { ProviderId } from '@homiio/shared-types';

/** How a single fetch attempt resolved. */
export type ProviderOutcome = 'success' | 'forbidden' | 'challenge' | 'error';

/** Which layer of the strategy ladder produced the attempt. */
export type StrategyName = 'api' | 'http' | 'browser' | 'managed';

/** One recorded fetch attempt against a provider. */
export interface ProviderMetricEvent {
  provider: ProviderId;
  strategy: StrategyName;
  outcome: ProviderOutcome;
  /** HTTP status when the attempt produced a response. */
  status?: number;
  /** Wall-clock latency of the attempt (ms). */
  latencyMs: number;
  /** The URL that was fetched. */
  url: string;
  /** Optional human detail (error message, challenge marker, …). */
  detail?: string;
}

/** Rolling counters + latency for one provider. */
export interface ProviderMetricsSnapshot {
  attempts: number;
  success: number;
  forbidden: number;
  challenge: number;
  error: number;
  /** Mean latency across recorded attempts (ms); 0 when no attempts yet. */
  avgLatencyMs: number;
  /** `(forbidden + challenge) / attempts`, in [0, 1]; 0 when no attempts. */
  challengeRate: number;
  /** Last event timestamp (epoch ms), or undefined when none recorded. */
  lastEventAt?: number;
}

/** Write side: the runtime records attempts here. */
export interface ProviderMetricsSink {
  record(event: ProviderMetricEvent): void;
}

/** Read side: providers derive health from here. */
export interface ProviderMetricsReader {
  snapshot(provider: ProviderId): ProviderMetricsSnapshot | undefined;
  all(): Record<string, ProviderMetricsSnapshot>;
}

interface MutableStat {
  attempts: number;
  success: number;
  forbidden: number;
  challenge: number;
  error: number;
  totalLatencyMs: number;
  lastEventAt?: number;
}

function emptyStat(): MutableStat {
  return { attempts: 0, success: 0, forbidden: 0, challenge: 0, error: 0, totalLatencyMs: 0 };
}

function toSnapshot(stat: MutableStat): ProviderMetricsSnapshot {
  const attempts = stat.attempts;
  return {
    attempts,
    success: stat.success,
    forbidden: stat.forbidden,
    challenge: stat.challenge,
    error: stat.error,
    avgLatencyMs: attempts > 0 ? Math.round(stat.totalLatencyMs / attempts) : 0,
    challengeRate: attempts > 0 ? (stat.forbidden + stat.challenge) / attempts : 0,
    lastEventAt: stat.lastEventAt,
  };
}

/**
 * In-process metrics store. Adequate for a single worker process; a later phase
 * can swap in a sink that pushes to a real metrics backend behind the same
 * {@link ProviderMetricsSink} interface without touching providers.
 */
export class InMemoryProviderMetrics implements ProviderMetricsSink, ProviderMetricsReader {
  private readonly stats = new Map<ProviderId, MutableStat>();
  private readonly onEvent?: (event: ProviderMetricEvent) => void;

  constructor(onEvent?: (event: ProviderMetricEvent) => void) {
    this.onEvent = onEvent;
  }

  record(event: ProviderMetricEvent): void {
    const stat = this.stats.get(event.provider) ?? emptyStat();
    stat.attempts += 1;
    stat[event.outcome] += 1;
    stat.totalLatencyMs += event.latencyMs;
    stat.lastEventAt = Date.now();
    this.stats.set(event.provider, stat);
    if (this.onEvent) this.onEvent(event);
  }

  snapshot(provider: ProviderId): ProviderMetricsSnapshot | undefined {
    const stat = this.stats.get(provider);
    return stat ? toSnapshot(stat) : undefined;
  }

  all(): Record<string, ProviderMetricsSnapshot> {
    const out: Record<string, ProviderMetricsSnapshot> = {};
    for (const [provider, stat] of this.stats) {
      out[provider] = toSnapshot(stat);
    }
    return out;
  }
}

/** A metrics sink that ignores everything (default when none is provided). */
export const NOOP_METRICS: ProviderMetricsSink & ProviderMetricsReader = {
  record: () => undefined,
  snapshot: () => undefined,
  all: () => ({}),
};

/**
 * Process-wide provider metrics. The strategy ladder records to this by
 * default and providers read it for `health()`; the worker can expose
 * {@link InMemoryProviderMetrics.all} on its health endpoint. A later phase can
 * hand the ladder a different sink (e.g. a StatsD/OTel bridge) without touching
 * any provider.
 */
export const defaultProviderMetrics = new InMemoryProviderMetrics();
