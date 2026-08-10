/**
 * Legal and housing resources, read by jurisdiction.
 *
 * There is deliberately NO write function here, and that is the design rather
 * than an omission. Homiio must not invent legal advice (#358's "no inventar
 * asesoramiento", and its out-of-scope list names automatic legal advice
 * outright), so a row exists only when a person checked a named public source
 * and recorded the date. That makes this CURATED REFERENCE DATA — the same
 * category as `countries` and `cities` — seeded by
 * `scripts/seedJurisdictionResources.ts` and never by a request.
 *
 * It also keeps the no-admin-surface veto intact: a write endpoint here would be
 * a privileged content surface with a different name.
 *
 * ## An expired resource is ABSENT, not stale
 *
 * `valid_until` is applied in the query. A tenant union's phone line that moved,
 * or a scheme that ended, is worse than no answer at all — somebody in the worst
 * week of their life calls a dead number. So the read refuses to return it and
 * the UI says nothing is available for this jurisdiction yet, which is true.
 */

import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import { jurisdictionResources } from '../schema/evictions';

export type JurisdictionResourceRow = typeof jurisdictionResources.$inferSelect;
export type JurisdictionResourceInsert = typeof jurisdictionResources.$inferInsert;

/**
 * Every currently valid resource for a country, plus the region's own.
 *
 * Region-scoped rows come FIRST because a local tenant union is more use than a
 * national portal, and a reader who stops after the first two entries should
 * have been shown the nearest help. National rows (`region_id IS NULL`) apply
 * everywhere in the country and are always included; a row belonging to a
 * DIFFERENT region is excluded, which is the half a naive "country match" query
 * gets wrong.
 */
export async function listJurisdictionResources(
  input: { readonly countryCode: string; readonly regionId?: string },
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly JurisdictionResourceRow[]> {
  const countryCode = input.countryCode.toUpperCase();
  return db
    .select()
    .from(jurisdictionResources)
    .where(
      and(
        eq(jurisdictionResources.countryCode, countryCode),
        // Valid means "not expired". A NULL `valid_until` is a resource nobody
        // put a deadline on, which is the common case for an official portal.
        or(
          isNull(jurisdictionResources.validUntil),
          gt(jurisdictionResources.validUntil, sql`now()`),
        ),
        input.regionId
          ? or(
              isNull(jurisdictionResources.regionId),
              eq(jurisdictionResources.regionId, input.regionId),
            )
          : isNull(jurisdictionResources.regionId),
      ),
    )
    .orderBy(
      // Region-scoped first: `region_id IS NULL` sorts as `true` (1) after
      // `false` (0) in Postgres' boolean ordering, so this puts the local rows
      // ahead of the national ones without a CASE expression.
      asc(sql`${jurisdictionResources.regionId} is null`),
      asc(jurisdictionResources.resourceType),
      asc(jurisdictionResources.title),
    );
}

/**
 * Insert or refresh one curated resource.
 *
 * Exported for the seed script alone — no controller imports it, and the module
 * header explains why. `ON CONFLICT … DO UPDATE` on `(country_code, url)` makes
 * re-running the seed converge instead of duplicating, and re-stamps
 * `verified_at` so "when was this last checked" stays a fact about the check
 * rather than about the first time anybody added it.
 */
export async function upsertJurisdictionResource(
  values: JurisdictionResourceInsert,
  db: DatabaseOrTransaction = getDb(),
): Promise<JurisdictionResourceRow> {
  const [row] = await db
    .insert(jurisdictionResources)
    .values(values)
    .onConflictDoUpdate({
      target: [jurisdictionResources.countryCode, jurisdictionResources.url],
      set: {
        regionId: values.regionId ?? null,
        resourceType: values.resourceType,
        title: values.title,
        source: values.source,
        verifiedAt: values.verifiedAt,
        validUntil: values.validUntil ?? null,
        languages: values.languages,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}
