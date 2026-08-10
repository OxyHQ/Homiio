/**
 * The MATCH: given one domain fact, which watches care about it.
 *
 * ## This is the inverted query, and that is the point
 *
 * The issue rules out the obvious shape — "no ejecutar una query completa por
 * usuario por cada listing" — and it is right to: re-running every saved search
 * for every listing that moves is O(watches × events) full-text-and-filter
 * queries, and it has no transition to be idempotent about. What runs instead is
 * ONE indexed statement per event, asking the opposite question: which stored
 * AREAS contain this point? `saved_searches_area_geo_gist` answers it, and the
 * rule join narrows to the watches subscribing to this particular change.
 *
 * The cost profile is the reverse of the naive version: it grows with the number
 * of events, which is the number of things that actually changed, rather than
 * with the number of watches, which is the number of people using the feature.
 *
 * ## Every clause here has a matching human-readable reason
 *
 * `watchAlertStatus` in the saved-search repository derives the SAME predicate
 * for display. Two expressions of one rule that nothing compares is how a status
 * reading "active" over a watch that matches nothing gets shipped, so the
 * integration suite asserts both for every reason: the matcher delivers nothing
 * AND the DTO names that reason.
 */

import { and, eq, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { HousingAlertRuleType, PushPrivacyMode, WatchCadence } from '@homiio/shared-types';
import type { DatabaseOrTransaction } from '../postgres';
import { housingWatchRules, savedSearches } from '../schema';

/** Everything the matcher needs about a watch, without a second read. */
export interface CandidateWatch {
  readonly watchId: string;
  readonly oxyUserId: string;
  readonly name: string;
  readonly cadence: WatchCadence;
  readonly channels: readonly string[];
  readonly pushPrivacyMode: PushPrivacyMode;
  readonly mutedUntil: Date | null;
  /** The rule's own threshold, or NULL to use the rule spec's default. */
  readonly threshold: number | null;
}

export interface MatchableEvent {
  readonly type: HousingAlertRuleType;
  readonly longitude: number | null;
  readonly latitude: number | null;
  readonly occurredAt: Date;
}

/**
 * The watches this event should be considered against.
 *
 * MUTED watches ARE returned. A mute is a pause, not an unsubscribe: the caller
 * still claims the alert (so the transition is recorded and cannot be re-sent
 * later as news) and marks it `suppressed / muted`, which is what makes "we held
 * four alerts back while you were muted" a thing the history can say. A watch
 * with `cadence: 'off'` is excluded instead, because that is the switch meaning
 * "this is a saved search again, not a watch".
 *
 * An event with NO COORDINATES matches nothing and says so by returning an empty
 * list. Every rule Homiio can evaluate today is about a place, so a placeless
 * event is a producer defect rather than a fact about a wider area — and
 * matching every watch in the world would be the "degraded to a global feed"
 * failure ADR 0002 §4.3 forbids, arriving through the alert path instead of the
 * search path.
 */
export async function findMatchingWatches(
  db: DatabaseOrTransaction,
  event: MatchableEvent,
  limit: number,
): Promise<readonly CandidateWatch[]> {
  if (event.longitude === null || event.latitude === null) return [];

  const rows = await db
    .select({
      watchId: savedSearches.id,
      oxyUserId: savedSearches.oxyUserId,
      name: savedSearches.name,
      cadence: savedSearches.cadence,
      channels: savedSearches.channels,
      pushPrivacyMode: savedSearches.pushPrivacyMode,
      mutedUntil: savedSearches.mutedUntil,
      threshold: housingWatchRules.threshold,
    })
    .from(savedSearches)
    .innerJoin(
      housingWatchRules,
      and(
        eq(housingWatchRules.watchId, savedSearches.id),
        eq(housingWatchRules.type, event.type),
        eq(housingWatchRules.enabled, true),
      ),
    )
    .where(
      and(
        // `off` is the only cadence that opts out of matching entirely. `daily`
        // and `weekly` still match — they change WHEN the claimed alert is
        // delivered, not whether the transition is noticed, which is what lets a
        // digest group several changes to one listing instead of missing them.
        ne(savedSearches.cadence, 'off'),
        // A version-1 row holds a place LABEL in `query` and cannot be evaluated
        // without re-geocoding it, which is the homonym bug ADR 0002 §11.3
        // refuses. It asks for confirmation instead of firing.
        eq(savedSearches.queryVersion, 2),
        isNotNull(savedSearches.location),
        isNotNull(savedSearches.areaGeo),
        // An event that happened before this watch started watching is not news.
        // Compared against `occurred_at` rather than `now()`, so a backlogged
        // sweep does not hand every catch-up event to a watch created while it
        // was behind.
        lte(savedSearches.alertsActiveFrom, event.occurredAt),
        // `::geography` on both sides, so the predicate is measured on the
        // spheroid and is index-backed by the GiST index. `ST_Intersects` and
        // not `ST_Distance(...) < 0` — a distance in a WHERE clause cannot use
        // the index and degrades to a sequential scan over every watch.
        sql`ST_Intersects(${savedSearches.areaGeo}, ST_MakePoint(${event.longitude}, ${event.latitude})::geography)`,
      ),
    )
    // Bounded. One event inside a very popular area must not produce an
    // unbounded fan-out inside a single transaction; the ceiling is logged by
    // the caller so hitting it is a capacity signal rather than silence.
    .limit(limit);

  return rows.map((row) => ({
    watchId: row.watchId,
    oxyUserId: row.oxyUserId,
    name: row.name,
    cadence: row.cadence,
    channels: row.channels,
    pushPrivacyMode: row.pushPrivacyMode,
    mutedUntil: row.mutedUntil,
    threshold: row.threshold,
  }));
}
