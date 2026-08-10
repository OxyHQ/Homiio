/**
 * Id-Shaped Columns That Carry No Foreign Key
 *
 * Two lists and one predicate. Between them and the real `.references()`
 * constraints, EVERY id-shaped column in this schema is classified — which is
 * what lets `__tests__/db/foreignKeys.test.ts` fail on a NEW one that nobody
 * decided about, rather than letting it ship unconstrained and be discovered as
 * an orphan row three batches later.
 *
 * `DEFERRED_FOREIGN_KEYS` is the TEMPORARY list: a constraint that is DECIDED
 * but not yet expressible, because the parent table has not landed. Homiio's
 * migration arrives in batches, so this list will be non-empty for most of it —
 * `properties.address_id` is decided today and cannot be written until
 * `properties` exists. The test turns each entry into a gate: the moment the
 * parent appears in the barrel, the run goes red naming every column that must
 * now reference it. An empty ledger is the finish line.
 *
 * `ID_COLUMNS_WITHOUT_FOREIGN_KEY` is the PERMANENT counterpart, and
 * {@link isOxyAccountColumn} is a predicate standing in for what would otherwise
 * be several hundred identical entries.
 *
 * ## The fact that shapes this file: there is no `users` table, and there never will be
 *
 * Oxy owns identity. Homiio reaches it over HTTP (`@oxyhq/core/server`
 * resolves the session), so **every `oxy_user_id` in this schema is a foreign
 * SERVICE's primary key** and can carry no foreign key. That is not a gap to
 * close later: a shadow `users` table would be a cache that can disagree with
 * Oxy, and validating on write would put an HTTP round trip in front of every
 * insert.
 *
 * `AGENTS.md` states the ownership rule in the same terms — property, room and
 * lease writes resolve the owner from the session `oxyUserId` and never accept
 * one from the client — so the absence of a constraint here is the same decision
 * seen from the database side, not a weaker version of it.
 */

import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgColumn, PgTable, UpdateDeleteAction } from 'drizzle-orm/pg-core';
import { sqlColumnName } from '../casing';
import { billing, billingProcessedSessions } from './billing';
import { housingAlerts, housingDomainEvents } from './watches';
import { images } from './images';
import { leasePaymentSchedule } from './leases';
import {
  moderationEnforcements,
  moderationEvents,
  moderationOutbox,
  moderationReports,
} from './moderation';
import { properties } from './properties';

/** A foreign key that is decided but not yet expressible. */
export interface DeferredForeignKey {
  readonly table: PgTable;
  readonly column: PgColumn;
  /** SQL name of the parent table, e.g. `properties`. */
  readonly parentTable: string;
  /** Column on the parent, e.g. `id`. */
  readonly parentColumn: string;
  /** Decided per relation — never left to default. */
  readonly onDelete: UpdateDeleteAction;
  /** Why that `ON DELETE`, in one line. */
  readonly reason: string;
}

/** An id-shaped column that will never carry a foreign key. */
export interface IdColumnWithoutForeignKey {
  readonly table: PgTable;
  readonly column: PgColumn;
  readonly reason: string;
}

/**
 * EMPTY — the finish line, reached in migration 0003.
 *
 * Migration 0000's six tables formed a CLOSED sub-graph, so nothing was
 * deferred. Migration 0001 opened the ledger with two entries, both on
 * `properties`: `agency_id` and `sourced_by_partner_id` were DECIDED but not
 * expressible, because `agencies` and `partners` did not exist yet. Migration
 * 0003 brought both parents and turned both entries into real `.references(…)`
 * constraints with the `ON DELETE SET NULL` recorded here — which is exactly
 * what `foreignKeys.test.ts`'s overdue check exists to force.
 *
 * It is empty rather than deleted because the mechanism outlives this migration:
 * the next table that lands ahead of its parent belongs here, and a reader
 * needs to find the shape rather than reinvent it. An entry whose parent HAS
 * landed fails the gate by name.
 */
export const DEFERRED_FOREIGN_KEYS: readonly DeferredForeignKey[] = [];

/**
 * The SQL names of columns holding an OXY ACCOUNT id.
 *
 * A column named by any of these is a reference into Oxy's user table, reached
 * over HTTP, and can never carry a local constraint. A predicate rather than
 * several hundred individual entries because the reason is identical for every
 * one of them, and repeating it would bury the entries that have a reason of
 * their own.
 *
 * Through migration 0002 this set was populated IN ADVANCE, from the Mongoose
 * schemas the columns were expected to come from — none of those names existed
 * yet, because the geo tables and `images` have no owner. Migrations 0003-0007
 * land every remaining table, so it is now a MEASURED set rather than a
 * predicted one, and six predicted names turned out never to exist:
 *
 * | Predicted | What the schema actually has |
 * |---|---|
 * | `sender_oxy_user_id` | `RoommateRequest` names `from`/`to`, not sender/recipient |
 * | `user_oxy_user_id` | nothing; `Notification` uses `recipient_oxy_user_id` |
 * | `participant_oxy_user_id` | `Conversation` has ONE owner and no participants array |
 * | `organizer_oxy_user_id` | `EvictionCase` names its organizer `oxy_user_id` |
 * | `author_oxy_user_id` | `EvictionComment` names its author `oxy_user_id` |
 * | `partner_oxy_user_id` | `partners` names its own account `oxy_user_id` |
 *
 * They are REMOVED rather than left in place. A name in an allow-list that
 * matches nothing is indistinguishable from one that matches something, so a
 * stale entry makes the set impossible to review — and this set is the only
 * thing standing between an account column and shipping unclassified.
 *
 * `__tests__/db/foreignKeys.test.ts` asserts the predicate against a probe
 * column, so it cannot be silently broken by a change to the matching itself.
 *
 * Every name is the SQL spelling.
 */
export const OXY_ACCOUNT_COLUMN_NAMES: ReadonlySet<string> = new Set([
  // The owner of a property, lease co-tenancy, review, saved item, profile,
  // conversation, eviction case or comment, partner, billing record … — the
  // single most common column in the schema, and the one `AGENTS.md` forbids
  // accepting from a client.
  'oxy_user_id',
  // `RoommateRelationship` stores its pair SORTED, so neither side has a role
  // to be named after. Listed individually because the names do not end in
  // `oxy_user_id` and no pattern would catch them.
  'oxy_user1_id',
  'oxy_user2_id',
  // `RoommateRequest`'s two sides.
  'from_oxy_user_id',
  'to_oxy_user_id',
  // `ViewingRequest` and `ExchangeRequest` name their two sides.
  'requester_oxy_user_id',
  'owner_oxy_user_id',
  'host_oxy_user_id',
  // `Reservation`'s guest half; its host is `host_oxy_user_id` above.
  'guest_oxy_user_id',
  // `Notification`'s recipient.
  'recipient_oxy_user_id',
  // `ListingReport`, `EvictionReport`, `ModerationReport`.
  'reporter_oxy_user_id',
  // `Lease` names both parties; `TenantApplication` names the applicant and the
  // landlord.
  'landlord_oxy_user_id',
  'tenant_oxy_user_id',
  'applicant_oxy_user_id',
  // `ExchangeReview`'s two sides.
  'reviewer_oxy_user_id',
  'subject_oxy_user_id',
  // `Lease.documents[].uploadedBy` and `Lease.terminationNotice.givenBy`.
  'uploaded_by_oxy_user_id',
  'termination_notice_given_by_oxy_user_id',
]);

/**
 * True when `column` holds an Oxy account id.
 *
 * Uses {@link sqlColumnName}, NEVER `column.name`: the latter is the TypeScript
 * PROPERTY name (`oxyUserId`), so a set of snake_case names compared against it
 * would match NOTHING — and this predicate would answer `false` for every column
 * while looking perfectly correct, letting every account column through the gate
 * unclassified. That is the exact vacuous-check shape `db/casing.ts` documents,
 * and it is why the test exercises this function against a probe column whose
 * property name and SQL name differ.
 */
export function isOxyAccountColumn(column: PgColumn): boolean {
  return OXY_ACCOUNT_COLUMN_NAMES.has(sqlColumnName(column));
}

/**
 * Every id-shaped column that is NOT an Oxy account id and still carries no
 * foreign key. Each has its own reason; none of them is "we forgot".
 */
export const ID_COLUMNS_WITHOUT_FOREIGN_KEY: readonly IdColumnWithoutForeignKey[] = [
  {
    table: images,
    column: images.entityId,
    reason:
      'Polymorphic by `entity_type` across five nouns — a `properties.id`, ' +
      '`cities.id`, `regions.id`, `countries.id` or `profiles.id`. A single ' +
      'column cannot reference five tables, so this is permanent rather than ' +
      'deferred: it does not become expressible when the missing tables land. ' +
      'Mongo declared it with no `ref` for the same reason, and every read is ' +
      'already scoped by the `(entity_type, entity_id)` PAIR rather than by the ' +
      'id alone — which is the index this table carries and the reason a ' +
      'dangling id costs nothing beyond returning no rows.',
  },
  {
    table: properties,
    column: properties.sourceId,
    reason:
      'Not an id INTO anything — it is the PORTAL\'s own identifier for the ' +
      'ad (Idealista\'s listing number, Otodom\'s slug id), and the only ' +
      'reason it ends in `_id` is that Mongo named it `sourceId`. It is half ' +
      'of the `(source, source_id)` dedup key and references no table here or ' +
      'anywhere else. Listed rather than renamed because the name is what ' +
      'every provider plugin and the whole ingest path already call it.',
  },
  {
    table: properties,
    column: properties.moderationRestrictedByDecisionId,
    reason:
      'A CrowdSource decision-revision id — a foreign SERVICE\'s primary key, ' +
      'the same class as `oxy_user_id` but from a different service, so the ' +
      '`isOxyAccountColumn` predicate does not (and must not) cover it. ' +
      'Audit-only: nothing joins on it, and CrowdSource is switched off in ' +
      'production entirely (`CROWDSOURCE_ENABLED` is absent from both SSM and ' +
      'the live task definition), so every row holds NULL today.',
  },
  {
    table: moderationReports,
    column: moderationReports.reportedId,
    reason:
      'Polymorphic by `reported_type` across three nouns — a `properties.id`, ' +
      '`reviews.id` or `eviction_cases.id` — so a single column cannot ' +
      'reference it, the same permanent case as `images.entity_id`. A SECOND ' +
      'reason makes it permanent even if the polymorphism went away: this row ' +
      'must OUTLIVE the object it names. `listing_reports` and ' +
      '`eviction_reports` both CASCADE away with their subject, and this is the ' +
      'table that keeps what was delivered to CrowdSource and decided about a ' +
      'listing after the expiry sweep reaped the ad.',
  },
  {
    table: moderationReports,
    column: moderationReports.crowdSourceReportId,
    reason:
      'CrowdSource\'s own id for the report it accepted — a foreign SERVICE\'s ' +
      'primary key, the same class as `oxy_user_id` but from a different ' +
      'service, which is why `isOxyAccountColumn` does not (and must not) ' +
      'cover it.',
  },
  {
    table: moderationReports,
    column: moderationReports.crowdSourceCaseId,
    reason:
      'The CrowdSource case this report was filed into or merged with. A ' +
      'foreign service\'s key, and one Homiio does not control: CrowdSource ' +
      'decides when two reports become one case.',
  },
  {
    table: moderationReports,
    column: moderationReports.decisionId,
    reason:
      'A CACHE of a published CrowdSource decision, overwritten by a later ' +
      'revision and never edited in place. A foreign service\'s key, and ' +
      'deliberately not a reference to `moderation_enforcements` either — that ' +
      'table records what HOMIIO did, which is a different fact with a ' +
      'different lifecycle.',
  },
  {
    table: moderationOutbox,
    column: moderationOutbox.eventId,
    reason:
      'The inbound webhook event, and the ONE id-shaped column in this schema ' +
      'left unconstrained by REFUSAL rather than by impossibility. ' +
      '`moderation_events` is under its own expiry sweep with the same 90-day ' +
      'retention as this table, and two independent sweeps have no ordering ' +
      'between them: CASCADE would let the event sweep delete unprocessed ' +
      'decision work, RESTRICT would make the event sweep fail on its first ' +
      'batch. Either way one table\'s housekeeping would decide the other\'s ' +
      'correctness. The pairing survives without a constraint because ' +
      '`decisionApplyEventId` derives this row\'s own primary key from it.',
  },
  {
    table: moderationOutbox,
    column: moderationOutbox.caseId,
    reason: 'The CrowdSource case a decision belongs to — a foreign service\'s key.',
  },
  {
    table: moderationEvents,
    column: moderationEvents.caseId,
    reason:
      'The CrowdSource case, as the delivered event names it. A foreign ' +
      'service\'s key, and this table is a DEDUPE store plus an audit trail — ' +
      'it deliberately records what ARRIVED rather than what Homiio could ' +
      'resolve.',
  },
  {
    table: moderationEnforcements,
    column: moderationEnforcements.decisionId,
    reason:
      'The CrowdSource decision this action answered. A foreign service\'s key, ' +
      'and two thirds of the idempotency key `UNIQUE(decision_id, ' +
      'decision_revision, action)` — which is why it must not become a Homiio ' +
      'primary key either: an id from a service whose key space Homiio does not ' +
      'own cannot be one.',
  },
  {
    table: moderationEnforcements,
    column: moderationEnforcements.caseId,
    reason: 'The CrowdSource case — a foreign service\'s key.',
  },
  {
    table: moderationEnforcements,
    column: moderationEnforcements.subjectId,
    reason:
      'Polymorphic by `subject_type` across Homiio\'s own nouns (`property`, ' +
      '`review`), so one column cannot reference it — and, like ' +
      '`moderation_reports.reported_id`, the row is the durable record of what ' +
      'was done and must outlive the object it names.',
  },
  {
    table: billing,
    column: billing.plusStripeSubscriptionId,
    reason:
      'Stripe\'s subscription id. A foreign service\'s key, and one whose key ' +
      'SPACE differs between test and live mode — which is why it is a plain ' +
      'indexed column and must never become part of a Homiio key.',
  },
  {
    table: billingProcessedSessions,
    column: billingProcessedSessions.sessionId,
    reason:
      'Stripe\'s Checkout session id — a foreign service\'s key, same class as ' +
      '`billing.plus_stripe_subscription_id`. It is half of this table\'s ' +
      'unique key rather than a reference into anything: the row exists to ' +
      'record that a session was already credited, so its value is meaningful ' +
      'even after Stripe has forgotten the session.',
  },
  {
    table: leasePaymentSchedule,
    column: leasePaymentSchedule.transactionId,
    reason:
      'The payment processor\'s own reference for a recorded rent payment. A ' +
      'foreign service\'s key, written by `recordPayment` from whatever the ' +
      'processor returned, and never resolved against anything in this schema.',
  },
  {
    table: housingDomainEvents,
    column: housingDomainEvents.subjectId,
    reason:
      'Polymorphic by `subject_type` across four nouns — a `properties.id`, ' +
      '`addresses.id`, `eviction_cases.id` or `reviews.id` — so a single ' +
      'column cannot reference it, the same permanent case as ' +
      '`images.entity_id`. A SECOND reason makes it permanent even if the ' +
      'polymorphism went away: this row must OUTLIVE its subject. The whole ' +
      'point of a `listing_removed` event is that the listing is gone, and a ' +
      'cascade would delete the record of the thing having happened at the ' +
      'exact moment it happened.',
  },
  {
    table: housingAlerts,
    column: housingAlerts.subjectId,
    reason:
      'The same polymorphic subject as `housing_domain_events.subject_id`, ' +
      'copied onto the alert on purpose rather than reached through the event. ' +
      'The event EXPIRES on its own 90-day retention (`db/expiry.ts`) and the ' +
      'alert does not, so an alert that could only name its subject through ' +
      '`event_id` would become a history entry saying "something changed" the ' +
      'day the sweep ran. It is also what the cooldown unique index is keyed ' +
      'on, which a nullable reference through another table could not be.',
  },
];

/**
 * Every `*_id`-shaped column in a table, by SQL name.
 *
 * Deliberately matches on the SQL name (via {@link sqlColumnName}) rather than
 * the property name, for the reason spelled out on {@link isOxyAccountColumn} —
 * `endsWith('_id')` against `coverImageId` is `false`, so the property-name
 * version of this function would return an empty list for every table and the
 * gate built on it would pass over nothing.
 */
export function idShapedColumns(table: PgTable): PgColumn[] {
  return Object.values(getTableColumns(table)).filter((column) => {
    const name = sqlColumnName(column);
    return name === 'id' ? false : name.endsWith('_id') || name.endsWith('_ids');
  });
}

/** A stable `table.column` label, for a test failure message. */
export function columnLabel(column: PgColumn): string {
  return `${getTableName(column.table)}.${sqlColumnName(column)}`;
}
