/**
 * The engine: a domain fact in, delivered alerts out.
 *
 * Four stages, kept separate exactly as the issue asks, each owned elsewhere and
 * only SEQUENCED here — the fact (`db/watches/domainEventRepository`), the match
 * (`db/watches/watchMatching`), the dedupe (`housing_alerts`' two unique
 * indexes) and the delivery (`notificationDispatchService`, the one in-app
 * chokepoint this project has).
 *
 * ## The order of the two writes is the whole design
 *
 * CLAIM FIRST, DELIVER SECOND. The alert row is inserted before anything is
 * sent, so the idempotency key is taken before the side effect happens. Reverse
 * them and a crash between the two re-delivers on the next run — which is the
 * failure the issue's "mismo evento entregado dos veces al dispatcher" test is
 * about. This ordering costs a `pending` row when delivery fails, which the
 * digest sweep retries; the reverse costs a person being told twice, which
 * nothing can undo.
 *
 * ## The three ways an alert is deliberately not delivered
 *
 * All THREE record a row rather than doing nothing, because "you have no alerts"
 * and "we held four back" are different answers and only one of them tells
 * somebody what to change:
 *
 *  - `muted` — the watch is paused. The transition is still claimed, so
 *    unmuting does not replay it as news.
 *  - `rate_limited` — the per-watch or per-user daily ceiling. A cap on
 *    DELIVERIES, never on rows: a row is an audit trail, a delivery is a
 *    person's attention, and only the second is scarce.
 *  - `channel_unavailable` — every channel the watch asked for lacks a writer.
 *    Cannot happen while `in_app` is mandatory in the schema, and is handled
 *    rather than asserted because a CHECK is not a promise about the future.
 *
 * ## What CANNOT reach here
 *
 * Backfill events, refused in {@link matchDomainEvent} before any query runs.
 * That is the mechanism behind "no notificar la primera indexación del catálogo
 * como miles de nuevos", and it is the half a per-watch `alerts_active_from`
 * cannot cover: a watch created a month ago is legitimately older than every
 * listing a bulk re-index produces today.
 */

import {
  HOUSING_ALERT_RULE_SPECS,
  HOUSING_ALERT_RULE_VERSION,
  isRuleAvailable,
  serializeLocationToken,
  type AlertChannel,
  type AlertExplanation,
  type AlertExplanationDetail,
  type LocationSelection,
} from '@homiio/shared-types';
import { getDb } from '../../db/postgres';
import type { Database, DatabaseOrTransaction } from '../../db/postgres';
import {
  alertIdempotencyKey,
  type HousingDomainEventRow,
} from '../../db/watches/domainEventRepository';
import {
  claimAlert,
  cooldownBucketFor,
  countDeliveredSince,
  markAlertDelivered,
  markAlertFailed,
  markAlertSuppressed,
  type HousingAlertRow,
} from '../../db/watches/alertRepository';
import { findMatchingWatches, type CandidateWatch } from '../../db/watches/watchMatching';
import { savedSearches } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../../middlewares/logging';
import notificationDispatchService from '../notificationDispatchService';
import {
  alertNarrative,
  alertNotificationData,
  HOUSING_ALERT_NOTIFICATION_TYPE,
} from './alertNarrative';

/**
 * How many watches one event may fan out to inside a single pass.
 *
 * A ceiling rather than a promise: hitting it is logged so it reads as a
 * capacity signal instead of as silence. It bounds the work one very popular
 * area can create, which is the only unbounded dimension in this loop.
 */
const MAX_WATCHES_PER_EVENT = 500;

/** Deliveries per watch per rolling day. Beyond it, alerts are recorded and held. */
export const MAX_DELIVERIES_PER_WATCH_PER_DAY = 40;

/** Deliveries per person per rolling day, across every watch they own. */
export const MAX_DELIVERIES_PER_USER_PER_DAY = 120;

const ONE_DAY_MS = 86_400_000;

export interface MatchOutcome {
  readonly matched: number;
  readonly created: number;
  readonly delivered: number;
  readonly suppressed: number;
  readonly duplicates: number;
}

const EMPTY_OUTCOME: MatchOutcome = {
  matched: 0,
  created: 0,
  delivered: 0,
  suppressed: 0,
  duplicates: 0,
};

/**
 * The explanation an event produces for a watch, or `null` when this particular
 * watch should not be told.
 *
 * Returning `null` is how a THRESHOLD is applied: a 1.2% price move is a real
 * transition and a real match, and it is simply below what this watch asked to
 * hear about. It is deliberately decided per watch rather than per event —
 * thresholds are a per-watch setting, so two people watching the same street can
 * legitimately disagree about whether the same move is news.
 */
function explanationFor(
  event: HousingDomainEventRow,
  watch: CandidateWatch,
): AlertExplanation | null {
  const spec = HOUSING_ALERT_RULE_SPECS[event.type];
  const transition = event.transition as Record<string, unknown>;
  const detail = detailFor(event, watch, transition, spec.supportsThreshold);
  if (!detail) return null;
  return {
    watchName: watch.name,
    watchId: watch.watchId,
    ruleType: event.type,
    ruleVersion: HOUSING_ALERT_RULE_VERSION,
    detail,
  };
}

/** A finite number from an untrusted jsonb field, or `null`. */
function numberField(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A non-empty string from an untrusted jsonb field, or a stated fallback. */
function stringField(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function detailFor(
  event: HousingDomainEventRow,
  watch: CandidateWatch,
  transition: Record<string, unknown>,
  supportsThreshold: boolean,
): AlertExplanationDetail | null {
  // A listing with no usable title is described as "a home" rather than as
  // `undefined` or as its id — an id in a notification is both meaningless to
  // the reader and a thing that should not be published.
  const listingTitle = stringField(transition, 'title', 'A home');

  switch (event.type) {
    case 'new_listing':
      return {
        kind: 'new_listing',
        listingTitle,
        offering: stringField(transition, 'offering', 'long_term_rent'),
      };

    case 'price_decrease':
    case 'price_increase': {
      const fromAmount = numberField(transition, 'fromAmount');
      const toAmount = numberField(transition, 'toAmount');
      // A price transition with no before or after is not a price transition.
      // Refused rather than described as a move from zero, which would be a
      // sentence stating something false about somebody's rent.
      if (fromAmount === null || toAmount === null || fromAmount === 0) return null;

      const percent = ((toAmount - fromAmount) / Math.abs(fromAmount)) * 100;
      const direction = event.type === 'price_decrease' ? 'decrease' : 'increase';
      // The producer decides WHICH rule fired; this only refuses a transition
      // whose sign contradicts it, which would be a producer defect rather than
      // something to narrate.
      if (direction === 'decrease' && percent >= 0) return null;
      if (direction === 'increase' && percent <= 0) return null;

      if (supportsThreshold) {
        const threshold =
          watch.threshold ?? HOUSING_ALERT_RULE_SPECS[event.type].defaultThreshold ?? 0;
        if (Math.abs(percent) < threshold) return null;
      }

      return {
        kind: 'price_change',
        direction,
        listingTitle,
        fromAmount,
        toAmount,
        currency: stringField(transition, 'currency', 'EUR'),
        percent: Math.round(percent * 10) / 10,
      };
    }

    case 'cost_terms_changed': {
      const terms = Array.isArray(transition.terms)
        ? transition.terms.filter((term): term is string => typeof term === 'string')
        : [];
      if (terms.length === 0) return null;
      return { kind: 'cost_terms_changed', listingTitle, terms };
    }

    case 'listing_removed':
      return { kind: 'listing_removed', listingTitle };

    case 'listing_reappeared':
      return {
        kind: 'listing_reappeared',
        listingTitle,
        sourceName: stringField(transition, 'source', 'another source'),
      };

    case 'new_review':
      return {
        kind: 'new_review',
        buildingLabel: stringField(transition, 'buildingLabel', 'a building you follow'),
      };

    case 'eviction_nearby': {
      const radius = numberField(transition, 'approximateRadiusMeters');
      // ADR 0003 §7.1 publishes a centre and a STATED radius. Without the radius
      // there is no honest way to say how approximate this is, and a sentence
      // that omits it reads as precise — the exact failure §7.1 describes.
      if (radius === null) return null;
      return {
        kind: 'eviction_nearby',
        approximateRadiusMeters: radius,
        areaLabel: watch.name,
      };
    }

    case 'source_conflict': {
      const sourceCount = numberField(transition, 'sourceCount');
      if (sourceCount === null || sourceCount < 2) return null;
      return { kind: 'source_conflict', listingTitle, sourceCount };
    }

    default: {
      const exhaustive: never = event.type;
      return exhaustive;
    }
  }
}

/**
 * The `loc` token that reopens a watch's query.
 *
 * Read from the watch's stored selection through ADR 0002's own serialiser. A
 * selection the grammar cannot express (a drawn polygon) yields `undefined`, and
 * the notification then opens the saved list instead of inventing a URL that
 * would reopen a WIDER area than the one the person is watching.
 */
async function locTokenForWatch(
  db: DatabaseOrTransaction,
  watchId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ location: savedSearches.location })
    .from(savedSearches)
    .where(eq(savedSearches.id, watchId))
    .limit(1);
  if (!row?.location || typeof row.location !== 'object') return undefined;
  const token = serializeLocationToken(row.location as unknown as LocationSelection);
  return token.ok ? token.value : undefined;
}

/** Which of the watch's chosen channels have a writer behind them today. */
function deliverableChannels(watch: CandidateWatch): AlertChannel[] {
  // Only `in_app` has an idempotent writer. `push` and `email` are stored
  // preferences with no transport — see `DELIVERABLE_ALERT_CHANNELS` — and
  // filtering here rather than asserting means adding a transport is a one-line
  // change in the contract rather than an edit to this loop.
  return watch.channels.filter((channel): channel is AlertChannel => channel === 'in_app');
}

/**
 * Match one event against every interested watch, and deliver what should be
 * delivered.
 *
 * Best effort per watch: one watch's failure is logged and the rest of the fan
 * out continues, because a single unreachable mailbox must not stop everybody
 * else being told. The claim has already happened by then, so the failed one is
 * `failed` rather than lost, and the digest sweep retries it.
 */
export async function matchDomainEvent(
  event: HousingDomainEventRow,
  db: Database = getDb(),
  now: Date = new Date(),
): Promise<MatchOutcome> {
  // The first-indexing guard, before any query runs. See the module header.
  if (event.isBackfill) return EMPTY_OUTCOME;
  // A rule nothing can evaluate correctly produces nothing, whatever a stored
  // row says. The API refuses to enable one; this is the second half of that,
  // for a rule that becomes unavailable AFTER somebody enabled it.
  if (!isRuleAvailable(event.type)) return EMPTY_OUTCOME;

  const watches = await findMatchingWatches(
    db,
    {
      type: event.type,
      longitude: event.longitude,
      latitude: event.latitude,
      occurredAt: event.occurredAt,
    },
    MAX_WATCHES_PER_EVENT,
  );
  if (watches.length === MAX_WATCHES_PER_EVENT) {
    logger.warn('Housing alert fan-out hit its ceiling; some watches were not considered', {
      eventId: event.id,
      type: event.type,
      ceiling: MAX_WATCHES_PER_EVENT,
    });
  }

  let created = 0;
  let delivered = 0;
  let suppressed = 0;
  let duplicates = 0;

  for (const watch of watches) {
    try {
      const explanation = explanationFor(event, watch);
      // Below the watch's threshold, or a transition this rule cannot describe.
      // Not an error and not a suppression: nothing matched for this watch.
      if (!explanation) continue;

      const spec = HOUSING_ALERT_RULE_SPECS[event.type];
      const claim = await claimAlert(db, {
        watchId: watch.watchId,
        oxyUserId: watch.oxyUserId,
        eventId: event.id,
        ruleType: event.type,
        ruleVersion: HOUSING_ALERT_RULE_VERSION,
        idempotencyKey: alertIdempotencyKey({
          watchId: watch.watchId,
          ruleType: event.type,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          transition: event.transition,
        }),
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        cooldownBucket: cooldownBucketFor(spec.cooldownHours, event.occurredAt),
        explanation,
      });

      if (!claim.created) {
        duplicates += 1;
        continue;
      }
      created += 1;
      const alert = claim.alert;
      if (!alert) continue;

      const outcome = await deliverAlert(db, alert, watch, explanation, now);
      if (outcome === 'delivered') delivered += 1;
      else if (outcome === 'suppressed') suppressed += 1;
    } catch (error) {
      logger.error('Housing alert matching failed for one watch', {
        eventId: event.id,
        watchId: watch.watchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { matched: watches.length, created, delivered, suppressed, duplicates };
}

export type DeliveryOutcome = 'delivered' | 'suppressed' | 'held' | 'failed';

/**
 * Deliver one claimed alert, or record why it was not delivered.
 *
 * `held` is the digest path: a `daily` or `weekly` watch leaves the row
 * `pending`, and `deliverPendingAlerts` picks it up when the window closes. It
 * is not a suppression — nothing was decided against — which is why it is a
 * separate outcome rather than a fourth suppression reason.
 */
export async function deliverAlert(
  db: Database,
  alert: HousingAlertRow,
  watch: CandidateWatch,
  explanation: AlertExplanation,
  now: Date = new Date(),
): Promise<DeliveryOutcome> {
  if (watch.mutedUntil && watch.mutedUntil > now) {
    await markAlertSuppressed(db, alert.id, 'muted');
    return 'suppressed';
  }

  const channels = deliverableChannels(watch);
  if (channels.length === 0) {
    await markAlertSuppressed(db, alert.id, 'channel_unavailable');
    return 'suppressed';
  }

  if (watch.cadence !== 'instant') return 'held';

  const since = new Date(now.getTime() - ONE_DAY_MS);
  const [perWatch, perUser] = await Promise.all([
    countDeliveredSince(db, { watchId: watch.watchId }, since),
    countDeliveredSince(db, { oxyUserId: watch.oxyUserId }, since),
  ]);
  if (
    perWatch >= MAX_DELIVERIES_PER_WATCH_PER_DAY ||
    perUser >= MAX_DELIVERIES_PER_USER_PER_DAY
  ) {
    await markAlertSuppressed(db, alert.id, 'rate_limited');
    return 'suppressed';
  }

  const narrative = alertNarrative(explanation, watch.pushPrivacyMode);
  const notification = await notificationDispatchService.createForUser(watch.oxyUserId, {
    type: HOUSING_ALERT_NOTIFICATION_TYPE,
    title: narrative.title,
    message: narrative.message,
    data: alertNotificationData({
      alertId: alert.id,
      watchId: watch.watchId,
      explanation,
      locToken: await locTokenForWatch(db, watch.watchId),
      subjectType: alert.subjectType,
      subjectId: alert.subjectId,
      push: narrative.push,
    }),
  });

  if (!notification) {
    // The chokepoint swallows its own failures and answers `null` — that is its
    // contract, so this is the only place the failure is visible. `failed`
    // rather than `delivered` so the digest sweep retries it, and rather than
    // `suppressed` because nothing was decided against.
    await markAlertFailed(db, alert.id);
    return 'failed';
  }

  await markAlertDelivered(db, alert.id, channels, notification.id);
  return 'delivered';
}
