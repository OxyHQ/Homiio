/**
 * The sweeps — the explicit jobs the issue asks for in place of event-driven
 * fan-out ("jobs/sweep explícitos si no se usa event-driven").
 *
 * Two of them, and they are separate because they answer separate questions:
 *
 *  - {@link runHousingAlertSweep} drains the event queue: claim a batch of
 *    unprocessed facts and match each one. Producers record and return; nothing
 *    on a request path waits for a fan-out.
 *  - {@link deliverDueDigests} closes a cadence window: collect a watch's
 *    `pending` alerts, group them, and send ONE notification.
 *
 * ## Why the producer does not match inline
 *
 * The ingestion worker upserts thousands of listings in a pass. Matching inline
 * would put a spatial fan-out inside that loop and make a slow or failing
 * matcher a slow or failing INGEST — coupling a best-effort notification to the
 * catalogue write, which is the exact coupling `notificationDispatchService`
 * swallows its own errors to avoid, one layer up.
 *
 * ## The digest's schedule IS its state
 *
 * There is no `last_digest_at` column, deliberately. The cron runs the daily
 * digest once a day and the weekly one once a week, so "has this window closed?"
 * is answered by the scheduler rather than by a timestamp two processes could
 * disagree about. A missed run costs a delay; a duplicated run costs nothing at
 * all, because the second finds no `pending` rows — the alerts were marked
 * `delivered` inside the first.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AlertChannel, AlertExplanation, WatchCadence } from '@homiio/shared-types';
import { getDb, type Database } from '../../db/postgres';
import { housingAlerts, savedSearches } from '../../db/schema';
import {
  claimUnprocessedEvents,
  countUnprocessedEvents,
} from '../../db/watches/domainEventRepository';
import {
  listPendingAlerts,
  markAlertDelivered,
  markAlertFailed,
  markAlertSuppressed,
} from '../../db/watches/alertRepository';
import { logger } from '../../middlewares/logging';
import notificationDispatchService from '../notificationDispatchService';
import {
  digestNarrative,
  HOUSING_ALERT_NOTIFICATION_TYPE,
} from './alertNarrative';
import { matchDomainEvent } from './housingAlertMatcher';

/** Events claimed per sweep. Bounded so one pass cannot run for an hour. */
const EVENT_BATCH_SIZE = 200;

/** Pending alerts examined per digest run. */
const DIGEST_BATCH_SIZE = 2_000;

export interface AlertSweepResult {
  readonly claimed: number;
  readonly matched: number;
  readonly created: number;
  readonly delivered: number;
  readonly suppressed: number;
  readonly duplicates: number;
  /** Still queued AFTER this pass — a backlog signal, not an error. */
  readonly remaining: number;
}

/**
 * Drain one batch of the event queue.
 *
 * Every counter is reported on every run, including the empty ones. An unwired
 * sweep and a quiet market are otherwise the same silence, and the expiry sweep
 * next door records what that costs: a job nobody scheduled has no symptom until
 * somebody notices months of nothing.
 */
export async function runHousingAlertSweep(db: Database = getDb()): Promise<AlertSweepResult> {
  const events = await claimUnprocessedEvents(db, EVENT_BATCH_SIZE);

  let matched = 0;
  let created = 0;
  let delivered = 0;
  let suppressed = 0;
  let duplicates = 0;

  for (const event of events) {
    // Per event, so one malformed fact cannot stop the batch. The event stays
    // claimed either way: re-running it would converge on the same alert rows,
    // so the only thing a retry would buy is another copy of the same failure.
    try {
      const outcome = await matchDomainEvent(event, db);
      matched += outcome.matched;
      created += outcome.created;
      delivered += outcome.delivered;
      suppressed += outcome.suppressed;
      duplicates += outcome.duplicates;
    } catch (error) {
      logger.error('Housing alert sweep failed on one event', {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    claimed: events.length,
    matched,
    created,
    delivered,
    suppressed,
    duplicates,
    remaining: await countUnprocessedEvents(db),
  };
}

export interface DigestResult {
  readonly cadence: WatchCadence;
  readonly watches: number;
  readonly alerts: number;
  readonly delivered: number;
  readonly suppressed: number;
}

/** A watch's pending alerts, plus what the watch needs for delivery. */
interface PendingBundle {
  readonly watchId: string;
  readonly oxyUserId: string;
  readonly name: string;
  readonly pushPrivacyMode: string;
  readonly mutedUntil: Date | null;
  readonly channels: readonly string[];
  readonly alertIds: string[];
  readonly explanations: AlertExplanation[];
  /** `subjectType:subjectId` per alert, for the grouping the issue asks for. */
  readonly subjects: string[];
}

/**
 * Send the digest for every watch on this cadence that has something waiting.
 *
 * Grouping is per WATCH and then per SUBJECT: several changes to one listing
 * become one line, which is the issue's "agrupar múltiples eventos del mismo
 * listing". Every alert is still its own row with its own explanation — the
 * grouping is a presentation decision and never a reason to lose a record.
 */
export async function deliverDueDigests(
  cadence: Extract<WatchCadence, 'daily' | 'weekly'>,
  db: Database = getDb(),
  now: Date = new Date(),
): Promise<DigestResult> {
  const pending = await listPendingAlerts(db, DIGEST_BATCH_SIZE);
  if (pending.length === 0) {
    return { cadence, watches: 0, alerts: 0, delivered: 0, suppressed: 0 };
  }

  const watchRows = await db
    .select({
      id: savedSearches.id,
      oxyUserId: savedSearches.oxyUserId,
      name: savedSearches.name,
      cadence: savedSearches.cadence,
      channels: savedSearches.channels,
      pushPrivacyMode: savedSearches.pushPrivacyMode,
      mutedUntil: savedSearches.mutedUntil,
    })
    .from(savedSearches)
    .where(
      and(
        eq(savedSearches.cadence, cadence),
        inArray(savedSearches.id, [...new Set(pending.map((alert) => alert.watchId))]),
      ),
    );

  const bundles = new Map<string, PendingBundle>();
  for (const row of watchRows) {
    bundles.set(row.id, {
      watchId: row.id,
      oxyUserId: row.oxyUserId,
      name: row.name,
      pushPrivacyMode: row.pushPrivacyMode,
      mutedUntil: row.mutedUntil,
      channels: row.channels,
      alertIds: [],
      explanations: [],
      subjects: [],
    });
  }

  for (const alert of pending) {
    // A pending alert whose watch is on another cadence belongs to the other
    // run. Skipped rather than delivered here, so an `instant` alert that failed
    // its first delivery is retried by the instant path and does not silently
    // arrive inside somebody's weekly digest.
    const bundle = bundles.get(alert.watchId);
    if (!bundle) continue;
    bundle.alertIds.push(alert.id);
    bundle.explanations.push(alert.explanation as unknown as AlertExplanation);
    bundle.subjects.push(`${alert.subjectType}:${alert.subjectId}`);
  }

  let delivered = 0;
  let suppressed = 0;
  let alerts = 0;
  let watches = 0;

  for (const bundle of bundles.values()) {
    if (bundle.alertIds.length === 0) continue;
    watches += 1;
    alerts += bundle.alertIds.length;

    try {
      if (bundle.mutedUntil && bundle.mutedUntil > now) {
        for (const id of bundle.alertIds) await markAlertSuppressed(db, id, 'muted');
        suppressed += bundle.alertIds.length;
        continue;
      }

      const channels = bundle.channels.filter(
        (channel): channel is AlertChannel => channel === 'in_app',
      );
      if (channels.length === 0) {
        for (const id of bundle.alertIds) {
          await markAlertSuppressed(db, id, 'channel_unavailable');
        }
        suppressed += bundle.alertIds.length;
        continue;
      }

      const narrative = digestNarrative({
        watchName: bundle.name,
        explanations: bundle.explanations,
        distinctSubjects: new Set(bundle.subjects).size,
        cadence,
        pushPrivacyMode: bundle.pushPrivacyMode === 'detailed' ? 'detailed' : 'discreet',
      });

      const notification = await notificationDispatchService.createForUser(bundle.oxyUserId, {
        type: HOUSING_ALERT_NOTIFICATION_TYPE,
        title: narrative.title,
        message: narrative.message,
        data: narrative.data,
      });

      if (!notification) {
        for (const id of bundle.alertIds) await markAlertFailed(db, id);
        continue;
      }

      // One notification, several alerts, all pointing at it. That is what makes
      // "enlace a todos" work: the digest row carries the ids, and the history
      // screen resolves them into the full list.
      for (const id of bundle.alertIds) {
        await markAlertDelivered(db, id, channels, notification.id);
      }
      delivered += bundle.alertIds.length;
    } catch (error) {
      logger.error('Housing alert digest failed for one watch', {
        watchId: bundle.watchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { cadence, watches, alerts, delivered, suppressed };
}

/**
 * How many alerts are waiting, by delivery state.
 *
 * Exposed for the cron's log line so an operator can tell a stalled digest from
 * an idle one — the same "a sweep that did nothing must be distinguishable from
 * one that never ran" property the expiry sweep documents.
 */
export async function countAlertsByState(
  db: Database = getDb(),
): Promise<Record<string, number>> {
  // Aggregated by the database, not by loading every row and counting in
  // JavaScript — this runs on a schedule against a table that grows with the
  // product's success, and the naive version's cost is the whole history.
  const rows = await db
    .select({ state: housingAlerts.deliveryState, value: sql<number>`count(*)::int` })
    .from(housingAlerts)
    .groupBy(housingAlerts.deliveryState);
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.state] = row.value;
  return counts;
}
