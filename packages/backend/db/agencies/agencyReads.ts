/**
 * The agency READS — the public agency page and the create-review typeahead.
 *
 * Separate from `agencyWrites.ts` because the two answer different questions and
 * have different callers: the write path is the single derived-entity chokepoint
 * (`findOrCreateAgencyByName`), while these are ordinary public lookups with no
 * write of any kind.
 *
 * ## The prefix search is `LIKE`, and the escape is a different escape
 *
 * Mongo spelled it `{ normalizedName: { $regex: '^' + escapeRegex(term) } }`.
 * Its Postgres form is `LIKE $1 || '%'` on the same normalized column, so the
 * term goes through {@link escapeLikePattern} rather than `escapeRegex` — the
 * two metacharacter sets barely overlap, and porting the call site without
 * changing the escape silently turns a term containing `%` into a wildcard. See
 * `db/likePattern.ts`, which records the whole table.
 *
 * It is `LIKE`, not `ILIKE`, deliberately: `normalized_name` is already
 * case-folded by `normalizeAgencyName`, and so is the term, so a
 * case-insensitive operator would be doing the work twice — and would rule out
 * `agencies_normalized_name_key` as the index serving the scan, since a
 * left-anchored `LIKE` on a plain btree is index-backed and an `ILIKE` is not.
 */

import { asc, eq, like } from 'drizzle-orm';

import { getDb, type DatabaseOrTransaction } from '../postgres';
import { agencies } from '../schema';
import { escapeLikePattern } from '../likePattern';
import type { AgencyRow } from './agencyWrites';

/** How many agencies the create-review typeahead offers. Verbatim from the Mongo read. */
const AGENCY_SEARCH_LIMIT = 10;

/** One agency by its public slug, or `undefined`. */
export async function findAgencyBySlug(
  slug: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<AgencyRow | undefined> {
  const [row] = await db.select().from(agencies).where(eq(agencies.slug, slug)).limit(1);
  return row;
}

/**
 * Agencies whose normalized name STARTS WITH `normalizedTerm`, alphabetically.
 *
 * @param normalizedTerm Already through `normalizeAgencyName` — the caller
 *   normalizes because it also has to decide whether the term survived
 *   normalization at all (an empty result means "answer with no agencies",
 *   not "match everything").
 */
export async function findAgenciesByNamePrefix(
  normalizedTerm: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<AgencyRow[]> {
  return db
    .select()
    .from(agencies)
    .where(like(agencies.normalizedName, `${escapeLikePattern(normalizedTerm)}%`))
    .orderBy(asc(agencies.normalizedName))
    .limit(AGENCY_SEARCH_LIMIT);
}
