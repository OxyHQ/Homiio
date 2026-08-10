/**
 * Expiry Sweep Registry — the replacement for Homiio's Mongo TTL indexes
 *
 * The MECHANISM lives in `@oxyhq/db/expiry` (batched delete by `ctid`, one
 * statement per batch, a ceiling per table per call). This module is Homiio's
 * REGISTRY: one entry per table that used to carry a TTL index, and nothing
 * else. Re-exported here so a caller has one import path and so the rule below
 * sits where somebody porting a table will read it.
 *
 * ## The rule, because it is the quietest failure in this whole migration
 *
 * **A TTL index is a behaviour of the SOURCE that does not survive the port.**
 * Mongo reaps; Postgres does not. A table ported without an entry here grows
 * FOREVER — no error, no failing test, no symptom of any kind until disk.
 *
 * It is structurally invisible in review, and that is what makes it the first
 * risk on this migration's list rather than a footnote: the thing doing the work
 * was never in Homiio's code to be missed. There is no deleted call site, no
 * orphaned function, nothing a reviewer diffing the port would see go absent.
 * The only trace is a line in a Mongoose schema that the new schema file has no
 * reason to mention.
 *
 * So porting a collection is not done when its schema, its migration and its
 * backfill plan exist. If its Mongoose model declares `expireAfterSeconds`, it
 * is done only once a matching entry appears BELOW.
 *
 * ## Every entry needs to be checked for INTENT, not merely replicated
 *
 * A Mongo TTL index DELETES the document, unconditionally, once the deadline
 * passes. Two of Homiio's are already known NOT to mean that, and both are
 * recorded in the tracking issue rather than discovered during the cutover:
 *
 *  - **`Conversation.sharing.expiresAt` destroys the whole conversation.**
 *    `generateShareToken` sets it to +24h, so every conversation that was ever
 *    shared has been deleted a day later, with its messages. It is ported as
 *    "clear the sharing fields", NEVER as a delete — and a near-zero count in
 *    the census is evidence of the DAMAGE, not of safety.
 *  - **`Property.expiresAt`** reaps external listings. That one is genuine
 *    housekeeping and it is the reason `services/cron.ts` must be wired to this
 *    sweep in the same batch that ports `properties`: Mongo mowed those rows
 *    whether or not anyone remembered, and Postgres will not.
 *
 * ## Coexistence with reads
 *
 * Mongo's TTL monitor lags roughly its own check interval; this sweep lags one
 * call. An entry is only safe to add once its table's read paths are audited for
 * depending on a swept row already being GONE. Adding a read that relies on
 * absence turns the sweep interval into a correctness window.
 *
 * ## The registry was empty through migration 0000, and is not any more
 *
 * None of `countries`, `regions`, `cities`, `neighborhoods`, `images` or
 * `addresses` carried a TTL index, so an empty registry was the CORRECT state.
 * `properties` is the first table that needs one, and it needs it more than any
 * other table in this migration will: `expires_at` is populated on **100% of
 * production rows**, so the entire listing inventory is under an active scythe
 * today and would stop being reaped the moment the cutover lands.
 *
 * ## The complete census: FIVE TTL indexes, not six
 *
 * `grep -rn expireAfterSeconds models/` returns five, on `PropertySchema`,
 * `ConversationSchema`, `PlacePoiSchema`, `ModerationEvent` and
 * `ModerationOutbox`. Recorded because a wrong count is worse than no count: a
 * sixth nobody can find reads as an outstanding risk forever, and the whole
 * value of this registry is being able to say the set is CLOSED.
 *
 * Four of the five are ordinary housekeeping and are registered below. The
 * fifth is not, and it is the reason {@link EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE}
 * exists as data rather than as a warning in a comment.
 */

import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { ExpirySweepTarget } from '@oxyhq/db/expiry';
import { conversations } from './schema/conversations';
import { evictionCases } from './schema/evictions';
import { moderationEvents, moderationOutbox } from './schema/moderation';
import { placePois } from './schema/placePois';
import { properties } from './schema/properties';
import { housingDomainEvents } from './schema/watches';

export {
  type ExpirySweepOptions,
  type ExpirySweepResult,
  type ExpirySweepTarget,
  sweepAllExpiredRows,
  sweepExpiredRows,
} from '@oxyhq/db/expiry';

/**
 * Every table whose rows expire, with the retention Mongo's TTL index used.
 *
 * Every registered column MUST have a supporting btree index: the sweep's
 * predicate is a range scan, and Mongo's TTL index carried the same obligation
 * implicitly. `@oxyhq/db/assert`'s `findUnsupportedExpiryColumns` checks it
 * against the real database.
 *
 * **Registering a target is only half of the port.** This list is data; nothing
 * runs it. `services/cron.ts` must call `sweepAllExpiredRows` with it, and until
 * that lands the table still grows forever — the registry makes the omission
 * VISIBLE, it does not close it.
 */
export const EXPIRY_SWEEP_TARGETS: readonly ExpirySweepTarget[] = [
  {
    table: properties,
    column: properties.expiresAt,
    // Mongo declared `index: { expireAfterSeconds: 0 }`, i.e. the column IS the
    // deadline rather than a birth date to measure from.
    retentionSeconds: 0,
    reason:
      'Reaps external aggregator listings once the portal ad is assumed stale ' +
      '(the `pre(\'save\')` hook sets the deadline to now + ' +
      '`EXTERNAL_PROPERTY_TTL_DAYS`, default 30). INTENT CHECKED, and it is ' +
      'genuine housekeeping rather than a destructive TTL wearing a ' +
      'housekeeping name: the row it deletes is a cached copy of somebody ' +
      'else\'s advertisement, re-created by the next discover pass if the ad ' +
      'is still up. Deleting it cascades to `property_images`, ' +
      '`property_documents` and `property_availability_windows` — all of them ' +
      'copies of the same ad — but NOT to the `images` rows behind those ' +
      'photos, which is the pre-existing leak the census counted as 948 ' +
      'orphaned Image documents and which belongs to the image batch, not here.',
  },
  {
    table: placePois,
    column: placePois.expiresAt,
    retentionSeconds: 0,
    reason:
      'Reaps the nearby-services cache once a cell snapshot goes stale. INTENT ' +
      'CHECKED and genuine housekeeping: the row is an aggregate copy of ' +
      'OpenStreetMap data that `nearbyServicesService` re-fetches from Overpass ' +
      'on the next miss, it holds no user content and no place NAMES by design, ' +
      'and the service already treats a row past this instant as a miss — so ' +
      'nothing depends on the row being gone and nothing is lost when it is. ' +
      'The delete cascades to `place_poi_categories`, which is the same ' +
      'snapshot.',
  },
  {
    table: moderationOutbox,
    column: moderationOutbox.expiresAt,
    retentionSeconds: 0,
    reason:
      'The 90-day retention ceiling that stops a stalled dispatcher turning the ' +
      'moderation outbox into an unbounded table. INTENT CHECKED, and it is the ' +
      'one entry here whose safety depends on something OUTSIDE the database: a ' +
      'row may still be `pending` or `dead_letter` when its deadline passes, and ' +
      'sweeping it discards moderation work nobody did. Ninety days is chosen so ' +
      'that any operational alert fires long before it, which makes the alert a ' +
      'prerequisite of this entry rather than a nicety — the model states it and ' +
      'this repeats it because the sweep is where it stops being advice.',
  },
  {
    table: moderationEvents,
    column: moderationEvents.expiresAt,
    retentionSeconds: 0,
    reason:
      'The 90-day retention on the webhook dedupe store. INTENT CHECKED: a ' +
      'sender\'s retry schedule ends within a day, so the DEDUPE half only has ' +
      'to outlive that; the long tail is the AUDIT half — what a third party ' +
      'told this deployment to do — and 90 days is the answer the model already ' +
      'chose. Note `moderation_outbox.event_id` deliberately carries no foreign ' +
      'key into this table, precisely so this sweep and that one cannot decide ' +
      'each other\'s outcome.',
  },
  {
    table: housingDomainEvents,
    column: housingDomainEvents.expiresAt,
    retentionSeconds: 0,
    reason:
      'The 90-day retention on housing change FACTS (#356). INTENT CHECKED, and ' +
      'the check is what makes it safe rather than the number: an event is ' +
      'EVIDENCE for an alert that has already been delivered, never the alert ' +
      'itself. `housing_alerts.event_id` is `ON DELETE SET NULL` and every alert ' +
      'stores its own explanation, so this sweep costs the "why did I get this?" ' +
      'answer its supporting fact and costs the history nothing. It is the only ' +
      'entry here with NO Mongo ancestor — registered on the way IN rather than ' +
      'ported, because a table that grows with every listing change in the ' +
      'catalogue is exactly the shape this registry exists to catch, and the ' +
      'only reason the others needed catching is that nobody was there to ' +
      'register them at birth.',
  },
];

/** A column whose Mongo TTL index must NOT become a delete. */
export interface NonDeletingExpiryColumn {
  readonly table: PgTable;
  readonly column: PgColumn;
  /** What the deadline actually means, and what the correct port is. */
  readonly reason: string;
}

/**
 * TTL columns that must NEVER appear in {@link EXPIRY_SWEEP_TARGETS}.
 *
 * The registry above answers "which tables need a sweep". This one answers the
 * question that is easier to get wrong: which TTL index in the source is not
 * housekeeping at all. `__tests__/db/expiry.test.ts` fails if any column named
 * here is ever registered as a sweep target, so "check every TTL for INTENT"
 * stops being advice the moment somebody tidies up the registry.
 *
 * Without this list, a later reader comparing `grep expireAfterSeconds` against
 * the registry finds one short and closes the gap — which is the exact change
 * that would start deleting people's conversations.
 */
export const EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE: readonly NonDeletingExpiryColumn[] = [
  {
    table: conversations,
    column: conversations.sharingExpiresAt,
    reason:
      'This deadline belongs to a SHARE LINK, not to the row. Mongo\'s TTL index ' +
      'on `sharing.expiresAt` deletes the whole conversation and every message ' +
      'in it, and `generateShareToken` sets the deadline to +24h — so every ' +
      'conversation anyone has ever shared has been destroyed a day later, with ' +
      'the transcript the user was sharing. A near-zero row count is evidence of ' +
      'that DAMAGE, not of safety. The correct port clears the four `sharing_*` ' +
      'columns, which is exactly what `revokeSharing` already does; the read ' +
      'side needs nothing, because `findByShareToken` already refuses an expired ' +
      'token.',
  },
  {
    table: evictionCases,
    column: evictionCases.archivedAt,
    reason:
      'This deadline is a STAMP, not a scythe: `archived_at` records when a case ' +
      'left the public board, and the row must survive it. ADR 0003 §7.5 keeps ' +
      'the archived case deliberately — the anonymised outcome is what makes the ' +
      'board evidence of a pattern rather than a noticeboard — while the sweep ' +
      'in `services/evictionArchivalService.ts` deletes only the CONTACT block ' +
      'and the exact coordinates and drops the published precision. Registering ' +
      'it here as a sweep target would delete the case ninety days after its ' +
      'last edit, which is the opposite of the policy and would look like ' +
      'housekeeping in the diff. The actual deletion, at 24 months AFTER ' +
      'archival, is that service\'s second half and belongs there because it ' +
      'measures from this column rather than expiring it.',
  },
];
