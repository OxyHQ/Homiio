/** Local housing references only. Identity validation happens through Oxy before entering a transaction. */
import { asc, eq, sql } from 'drizzle-orm';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import { agencies } from '../schema';

export type AgencyRow = typeof agencies.$inferSelect;

/** Historical references may share an Oxy account; serialize new-reference creation per canonical account. */
export async function findOrCreateAgencyReference(
  oxyAccountId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<AgencyRow> {
  if (!oxyAccountId.trim()) throw new Error('A canonical organization account is required');
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`homiio-agency:${oxyAccountId}`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(agencies)
      .where(eq(agencies.oxyAccountId, oxyAccountId))
      .orderBy(asc(agencies.createdAt), asc(agencies.id))
      .limit(1);
    if (existing) return existing;
    // The Oxy account is opaque and unique; the historical URL is not a copied company name.
    const [created] = await tx
      .insert(agencies)
      .values({ oxyAccountId, identityStatus: 'linked', slug: `agency-${oxyAccountId}` })
      .returning();
    if (!created) throw new Error('Agency reference creation returned no row');
    return created;
  });
}
