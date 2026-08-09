/**
 * `agencies` — the property-management company a review or an external listing
 * is attributed to.
 *
 * Ported from `models/schemas/AgencySchema.ts`. **2,627 rows in production**,
 * which makes this one of only two remaining tables with real data (the other is
 * `profiles`, with five).
 *
 * Agencies are DERIVED entities: there is no authenticated create endpoint and
 * the only writer is `findOrCreateByName`, called when a tenant names their
 * managing agency on a review or when a portal's contact AJAX exposes one. That
 * single write path is what makes the two unique constraints below safe to
 * express — every row in production went through it.
 */

import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, updatedAt } from '@oxyhq/db';

export const agencies = pgTable(
  'agencies',
  {
    id: generatedId(),

    /** As the tenant or the portal spelled it. Trimmed at the call site. */
    name: text().notNull(),
    /**
     * The dedup key: diacritics stripped, case-folded, whitespace collapsed
     * (`utils/agencyName.normalizeAgencyName`).
     *
     * Copied VERBATIM by the backfill and never recomputed. `normalizeAgencyName`
     * is ordinary application code that can change, and recomputing during the
     * copy would silently re-key every existing agency and split reviews across
     * two rows that used to be one — the same rule, for the same reason, as
     * `addresses.normalized_key`.
     */
    normalizedName: text().notNull(),
    /** URL-safe public identifier, collision-suffixed (`base`, `base-2`, `base-3`, …). */
    slug: text().notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('agencies_normalized_name_key').on(table.normalizedName),
    uniqueIndex('agencies_slug_key').on(table.slug),
    /**
     * `agencyController` resolves an agency by an unanchored case-insensitive
     * name search, the same typeahead shape `cities` and `neighborhoods` carry.
     * Without a trigram index every keystroke is a sequential scan of 2,627 rows.
     */
    index('agencies_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
    /**
     * Mongoose declared `minlength: 2` on `name` and `findOrCreateByName` refuses
     * a normalized name shorter than two characters — so the shortest possible
     * row is two characters and this rejects nothing that exists. It is expressed
     * because an empty `normalized_name` would collide with every other empty one
     * under the unique index above, converting a non-problem into a live 500 on
     * the review-create path. The same trap `CONVENTIONS.md` records for
     * sparse-unique columns written `''`, reached from the other direction.
     */
    check('agencies_normalized_name_not_empty_check', sql`length(${table.normalizedName}) > 0`),
    check('agencies_slug_not_empty_check', sql`length(${table.slug}) > 0`),
  ],
);
