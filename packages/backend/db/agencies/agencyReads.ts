/** Local housing references, never name-based identity lookups. */
import { eq, inArray } from 'drizzle-orm';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import { agencies } from '../schema';
import type { AgencyRow } from './agencyWrites';

export async function findAgencyBySlug(
  slug: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<AgencyRow | undefined> {
  const [row] = await db.select().from(agencies).where(eq(agencies.slug, slug)).limit(1);
  return row;
}
export async function findAgenciesByIds(
  ids: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<AgencyRow[]> {
  if (!ids.length) return [];
  return db
    .select()
    .from(agencies)
    .where(inArray(agencies.id, [...ids]));
}
