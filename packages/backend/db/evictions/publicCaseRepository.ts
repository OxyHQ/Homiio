import { and, inArray, isNull } from 'drizzle-orm';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import { evictionCases } from '../schema/evictions';

// Only these columns can reach a cross-product card. Private location/contact
// columns are never loaded, even when this request has an authenticated session.
export async function listPublicCaseCards(
  ids: readonly string[],
  db: DatabaseOrTransaction = getDb(),
) {
  if (!ids.length) return [];
  return db
    .select({
      id: evictionCases.id,
      title: evictionCases.title,
      locationCity: evictionCases.locationCity,
      locationCountryCode: evictionCases.locationCountryCode,
      scheduledAt: evictionCases.scheduledAt,
      status: evictionCases.status,
    })
    .from(evictionCases)
    .where(
      and(
        inArray(evictionCases.id, [...new Set(ids)]),
        isNull(evictionCases.archivedAt),
        isNull(evictionCases.precautionaryHoldAt),
      ),
    );
}
