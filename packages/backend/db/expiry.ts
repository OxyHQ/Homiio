/**
 * Expiry Sweep Registry — how Homiio deletes rows whose deadline has passed
 *
 * The MECHANISM lives in `@oxy.so/db/expiry` (batched delete by `ctid`, one
 * statement per batch, a ceiling per table per call). This module is Homiio's
 * REGISTRY: one entry per table whose rows expire, and nothing else.
 * Re-exported here so a caller has one import path and so the rule below sits
 * where somebody adding a table will read it.
 *
 * ## The rule, because it is the quietest failure in this package
 *
 * **Postgres deletes nothing on a deadline.** A table whose rows are meant to
 * expire and that has no entry here grows FOREVER — no error, no failing test,
 * no symptom of any kind until disk.
 *
 * It is structurally invisible in review: there is no call site to notice
 * missing. So a table with an expiry column is not done when its schema and its
 * migration exist; it is done only once a matching entry appears BELOW.
 *
 * ## Every entry needs to be checked for INTENT, not merely registered
 *
 * A sweep DELETES the row, unconditionally, once the deadline passes. Not every
 * deadline column means that:
 *
 *  - **`conversations.sharing_expires_at` is the deadline of a share LINK.**
 *    `generateShareToken` sets it to +24h; deleting the row would delete the
 *    whole conversation, with its messages, a day after anybody shared it. It
 *    is handled as "clear the sharing fields", NEVER as a delete.
 *  - **`properties.expires_at`** reaps external listings. That one is genuine
 *    housekeeping, and `services/cron.ts` must stay wired to this sweep for it.
 *
 * ## Coexistence with reads
 *
 * This sweep lags one call. An entry is only safe to add once its table's read
 * paths are audited for depending on a swept row already being GONE. Adding a
 * read that relies on absence turns the sweep interval into a correctness
 * window.
 *
 * {@link EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE} exists as data rather than as a
 * warning in a comment for the share-link reason above.
 */

import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { ExpirySweepTarget } from '@oxy.so/db/expiry';
import { addressCandidates } from './schema/addressMaterialization';
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
} from '@oxy.so/db/expiry';

/**
 * Every table whose rows expire, with its retention.
 *
 * Every registered column MUST have a supporting btree index: the sweep's
 * predicate is a range scan. `@oxy.so/db/assert`'s `findUnsupportedExpiryColumns` checks it
 * against the real database.
 *
 * **Registering a target is only half of the job.** This list is data; nothing
 * runs it. `services/cron.ts` must call `sweepAllExpiredRows` with it, and until
 * that lands the table still grows forever — the registry makes the omission
 * VISIBLE, it does not close it.
 */
export const EXPIRY_SWEEP_TARGETS: readonly ExpirySweepTarget[] = [
  {
    table: properties,
    column: properties.expiresAt,
    // Retention 0: the column IS the deadline rather than a birth date to
    // measure from.
    retentionSeconds: 0,
    reason:
      'Reaps external aggregator listings once the portal ad is assumed stale ' +
      '(ingest sets the deadline to now + ' +
      '`EXTERNAL_PROPERTY_TTL_DAYS`, default 30). INTENT CHECKED, and it is ' +
      'genuine housekeeping rather than a destructive TTL wearing a ' +
      'housekeeping name: the row it deletes is a cached copy of somebody ' +
      "else's advertisement, re-created by the next discover pass if the ad " +
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
      "sender's retry schedule ends within a day, so the DEDUPE half only has " +
      'to outlive that; the long tail is the AUDIT half — what a third party ' +
      'told this deployment to do — and 90 days is the answer the model already ' +
      'chose. Note `moderation_outbox.event_id` deliberately carries no foreign ' +
      'key into this table, precisely so this sweep and that one cannot decide ' +
      "each other's outcome.",
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
      'answer its supporting fact and costs the history nothing. Registered at ' +
      'BIRTH, because a table that grows with every listing change in the ' +
      'catalogue is exactly the shape this registry exists to catch.',
  },
  {
    table: addressCandidates,
    column: addressCandidates.expiresAt,
    retentionSeconds: 0,
    reason:
      'The caducidad on an address CANDIDATE (#360). INTENT CHECKED, and the ' +
      'check is the whole reason this is safe: a candidate is an OBSERVATION — ' +
      'what somebody typed or a geocoder answered — and every fact an audit ' +
      'needs is copied BY VALUE onto `address_materializations` at the moment ' +
      'it produces a canonical row (provider, ref, raw text, its hash, the ' +
      'normalization version), which is also why `candidate_id` there carries ' +
      'no foreign key. So this sweep costs a materialized place nothing and ' +
      'costs an unmaterialized guess exactly what it is worth. Registered at ' +
      'BIRTH for the same reason as the one above: a table that grows with ' +
      'every keystroke in an autocomplete is the shape this registry exists to ' +
      'catch.',
  },
];

/** A deadline column that must NOT become a delete. */
export interface NonDeletingExpiryColumn {
  readonly table: PgTable;
  readonly column: PgColumn;
  /** What the deadline actually means, and what the correct handling is. */
  readonly reason: string;
}

/**
 * TTL columns that must NEVER appear in {@link EXPIRY_SWEEP_TARGETS}.
 *
 * The registry above answers "which tables need a sweep". This one answers the
 * question that is easier to get wrong: which deadline column is not
 * housekeeping at all. `__tests__/db/expiry.test.ts` fails if any column named
 * here is ever registered as a sweep target, so "check every deadline for
 * INTENT" stops being advice the moment somebody tidies up the registry.
 *
 * Without this list, a later reader who finds a deadline column missing from the
 * registry closes the gap — which is the exact change
 * that would start deleting people's conversations.
 */
export const EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE: readonly NonDeletingExpiryColumn[] = [
  {
    table: conversations,
    column: conversations.sharingExpiresAt,
    reason:
      'This deadline belongs to a SHARE LINK, not to the row. Deleting the row ' +
      'would delete the whole conversation and every message in it, and ' +
      '`generateShareToken` sets the deadline to +24h — so every conversation ' +
      'anyone shared would be destroyed a day later, with the transcript the ' +
      'user was sharing. The correct handling clears the four `sharing_*` ' +
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
      "archival, is that service's second half and belongs there because it " +
      'measures from this column rather than expiring it.',
  },
];
