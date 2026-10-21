/**
 * Log markers that CloudWatch metric filters match on.
 *
 * **These strings are a CROSS-REPO CONTRACT.** Each one is matched verbatim by
 * an `aws_cloudwatch_log_metric_filter` in
 * `oxy-infra/terraform-uswest2/alerts.tf`, which feeds an alarm on the
 * `oxy-alerts` SNS topic and from there the Telegram relay (oxy-infra runbook
 * 23). Renaming one here without changing the filter there does not break a
 * build, does not fail a test in that repo and produces no error anywhere — it
 * silently stops the alarm from ever firing again.
 *
 * That exact failure has a precedent in this account: the Kaana filter in the
 * same file carries a comment explaining that the singular spelling of one word
 * matched nothing at all. `__tests__/unit/ingestHealthMarkers.test.ts` pins
 * every literal below so a rename has to be deliberate, and the test names the
 * file to change on the other side.
 *
 * WHY MARKERS AND NOT `PutMetricData`: the worker's task role would need
 * `cloudwatch:PutMetricData`, the emit path would need its own retries and
 * failure handling, and a metric that fails to publish is invisible in the same
 * way this whole incident was invisible. A log line the process already knows
 * how to write, counted by AWS on the other side, has no such failure mode —
 * and it is the house pattern (`Oxy/Kaana` uses it for exactly this reason).
 */

/**
 * A non-fixture listing was ingested. This is the HEARTBEAT of the whole
 * aggregator, and the alarm on it is the catch-all: it fires whatever the cause
 * — dead proxy, a portal changing its markup, Redis gone, the worker crashed,
 * the queues silently drained — because all of those end in no homes arriving.
 *
 * **THE `fixture` PROVIDER MUST NEVER EMIT THIS, and that is not a detail.**
 * During the 2026-09-20 incident the seeded fixtures kept ingesting on every
 * worker boot, a steady 8 per day for the full two months the real pipeline was
 * dead. A naive "did anything ingest?" alarm would have counted those and
 * stayed green the entire time — a gate whose output is masked by test data is
 * worse than no gate, because it is trusted. See `emitIngestHeartbeat`.
 */
export const LISTING_INGEST_OK_MARKER = 'listing-ingest-ok';

/**
 * Market token appended to {@link LISTING_INGEST_OK_MARKER}, e.g.
 * `listing-ingest-ok market=ES provider=fotocasa`.
 *
 * A SECOND filter matches the longer substring `listing-ingest-ok market=ES`
 * and counts Spain alone, because the aggregate cannot see a single market
 * starving: on 2026-09-20 the database held 481 German listings and 31 Spanish
 * ones, and an aggregate heartbeat was green throughout. That is the fixture
 * problem one level up — a signal diluted by rows that are real but answer a
 * different question.
 *
 * Substring matching is why the market comes FIRST and the provider second:
 * `"listing-ingest-ok market=ES"` is a stable prefix, whereas a trailing market
 * would need the provider name to be part of the pattern.
 *
 * Kept deliberately dumb — one filter per market worth alarming on, rather than
 * a dimension extracted from a space-delimited pattern. Extracted dimensions
 * depend on the exact token layout of a line that also carries a timestamp, a
 * level and a logger name, and they fail by silently counting nothing.
 */
export function ingestMarketToken(market: string | undefined): string {
  return `market=${market ?? 'unknown'}`;
}

/**
 * The residential proxy refused to open a tunnel for a reason no retry fixes —
 * an exhausted balance (402) or rejected credentials (407). A human has to act.
 * Emitted by the worker's boot check and by every periodic re-check while the
 * condition holds, so the alarm's recovery is real rather than assumed.
 */
export const LISTING_PROXY_UNUSABLE_MARKER = 'listing-proxy-unusable';

/**
 * Providers whose ingests are seeded test data and must not count as a live
 * pipeline. Kept as a set so adding another seed provider is one edit and the
 * heartbeat stays honest.
 */
export const NON_LIVE_INGEST_PROVIDERS: ReadonlySet<string> = new Set(['fixture']);

/**
 * Whether ingesting from `provider` proves the live pipeline works.
 *
 * Used to gate {@link LISTING_INGEST_OK_MARKER}; see that constant for why
 * fixtures are excluded.
 */
export function countsAsLiveIngest(provider: string): boolean {
  return !NON_LIVE_INGEST_PROVIDERS.has(provider);
}
