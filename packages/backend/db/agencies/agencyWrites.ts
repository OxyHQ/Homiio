/**
 * The agency repository — resolving a raw agency name to a persisted row.
 *
 * Ported from `AgencySchema.statics.findOrCreateByName`, which the schema header
 * calls "the SOLE write path for the collection" and which the census confirms:
 * three static call sites (`reviewController` twice, `IngestionService` once)
 * plus one dynamic one (`controllers/eviction/shared.ts`, resolving through
 * `mongoose.models.Agency`). Agencies are DERIVED — no authenticated endpoint
 * creates one — so keeping the single entry point is what stops a second
 * spelling of "normalize, then dedupe" appearing beside this one.
 *
 * ## The read-then-write became an INSERT that handles `23505`
 *
 * `db/MIGRATION-CONTRACT.md` names this collection specifically: idempotency
 * that was a read-then-write with a race window becomes a unique KEY, and the
 * ported code inserts and handles the violation rather than re-implementing the
 * read. `agencies_normalized_name_key` is that key.
 *
 * The Mongoose static already handled the race — it caught 11000 and re-read —
 * so this is not new behaviour, it is the same behaviour expressed against an
 * index that actually enforces it. What IS new is that the two unique indexes
 * are told apart: a `normalized_name` violation means a concurrent writer
 * created the SAME agency and the winner is reused, while a `slug` violation
 * means a DIFFERENT agency wanted the same URL and the suffix advances. Matching
 * on `23505` alone would treat the second as the first and return somebody
 * else's agency, which is why `isUniqueViolation` takes a constraint name.
 *
 * ## Every attempt runs in a SAVEPOINT, and that is not defensive tidiness
 *
 * Catch-`23505`-then-continue works on the ROOT connection, where each statement
 * is its own implicit transaction, and is BROKEN inside one: in Postgres a
 * failed statement aborts the whole transaction, so the `select` in the
 * `normalized_name` branch and the retrying `insert` in the `slug` branch both
 * die with `25P02 current_transaction_is_aborted`.
 *
 * This function has taken a transaction handle since it was written — the
 * parameter's own comment says it is there "so the review create path can use
 * it" — and the review create path is the FIRST caller to actually pass one.
 * Without the savepoint that call site turns a slug collision (two different
 * agencies whose names slugify the same, an ordinary event) into a 500 on
 * `POST /api/reviews`, and it does so only under a transaction, which is why no
 * existing test saw it. `inSavepoint` issues a real `SAVEPOINT` /
 * `ROLLBACK TO SAVEPOINT` on a transaction handle and a plain `BEGIN`/`COMMIT`
 * on the root connection, so ONE spelling serves both callers.
 */

import { eq } from 'drizzle-orm';

import { getDb, inSavepoint } from '../postgres';
import { agencies } from '../schema';
import { isUniqueViolation } from '../uniqueViolation';
import { normalizeAgencyName, slugifyAgencyName } from '../../utils/agencyName';
import type { DatabaseOrTransaction } from '../postgres';

/** Carried over from `AgencySchema`, which validated both bounds on `name`. */
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 120;

/**
 * Bounded slug-suffix search before falling back to a timestamp suffix.
 *
 * Verbatim from the Mongoose static. Fifty deterministic attempts keep
 * `agency`, `agency-2`, … readable for every realistic collision; beyond that
 * the name is pathological and a stable-but-ugly slug beats an unbounded loop.
 */
const MAX_SLUG_ATTEMPTS = 50;

export type AgencyRow = typeof agencies.$inferSelect;

/**
 * Resolve a raw agency name to a persisted agency, creating it on first sight.
 *
 * Returns `null` when the name is empty or too short to identify an agency —
 * the caller simply skips agency attribution, exactly as it did against Mongo.
 * That is a deliberate non-failure: an unparseable contact block must not fail
 * an ingest or a review.
 *
 * @param db Optional transaction handle, so a caller that is already inside one
 *   (the review create path) resolves the agency in the same transaction rather
 *   than leaving a stray agency behind when its own write rolls back.
 */
export async function findOrCreateAgencyByName(
  rawName: unknown,
  db: DatabaseOrTransaction = getDb(),
): Promise<AgencyRow | null> {
  if (typeof rawName !== 'string') return null;
  const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
  const normalizedName = normalizeAgencyName(name);
  if (normalizedName.length < MIN_NAME_LENGTH) return null;

  const existing = await db
    .select()
    .from(agencies)
    .where(eq(agencies.normalizedName, normalizedName))
    .limit(1);
  if (existing[0]) return existing[0];

  const baseSlug = slugifyAgencyName(name) || 'agency';

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    try {
      const [created] = await inSavepoint(db, (tx) =>
        tx.insert(agencies).values({ name, normalizedName, slug }).returning(),
      );
      return created;
    } catch (error) {
      // A concurrent writer created the SAME agency — reuse the winner. This is
      // the only violation that means "already done"; anything else is a real
      // error and must not be swallowed.
      if (isUniqueViolation(error, 'agencies_normalized_name_key')) {
        const raced = await db
          .select()
          .from(agencies)
          .where(eq(agencies.normalizedName, normalizedName))
          .limit(1);
        if (raced[0]) return raced[0];
        continue;
      }
      // A DIFFERENT agency already holds this slug — advance the suffix.
      if (isUniqueViolation(error, 'agencies_slug_key')) continue;
      throw error;
    }
  }

  // Deterministic suffixes exhausted (pathological): last-resort unique slug.
  const [created] = await inSavepoint(db, (tx) =>
    tx
      .insert(agencies)
      .values({ name, normalizedName, slug: `${baseSlug}-${Date.now()}` })
      .returning(),
  );
  return created;
}
