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
 */

import type { ExpirySweepTarget } from '@oxyhq/db/expiry';
import { properties } from './schema/properties';

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
];
