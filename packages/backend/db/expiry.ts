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
 * ## Why this file exists while the registry is empty
 *
 * Migration 0000 carries `countries`, `regions`, `cities`, `neighborhoods`,
 * `images` and `addresses`, and not one of them has a TTL index — so an empty
 * registry is the CORRECT state, not an omission. It exists now so the rule
 * above is in the repository before the first table that needs it arrives, and
 * so `__tests__/db/` can already assert the shape of an entry.
 */

import type { ExpirySweepTarget } from '@oxyhq/db/expiry';

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
 * EMPTY, and correct: no table in migration 0000 carried a TTL index. Entries
 * arrive with the tables that need them — `properties.expires_at` (external
 * listing reaping) is the first one due.
 *
 * Every registered column MUST have a supporting btree index: the sweep's
 * predicate is a range scan, and Mongo's TTL index carried the same obligation
 * implicitly. `@oxyhq/db/assert`'s `findUnsupportedExpiryColumns` checks it
 * against the real database.
 */
export const EXPIRY_SWEEP_TARGETS: readonly ExpirySweepTarget[] = [];
