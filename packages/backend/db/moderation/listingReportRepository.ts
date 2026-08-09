/**
 * `listing_reports` — a trust & safety report filed against a property listing.
 *
 * It lives under `db/moderation/` rather than `db/properties/` because the
 * moderation intake path is its ONLY writer: `controllers/reportController.ts`
 * creates every row, inside the same transaction as the `moderation_reports` row
 * that will actually be delivered. Nothing else in the backend inserts, updates
 * or deletes one (`git grep ListingReport` reaches exactly that controller, the
 * route that mounts it, and the model barrel). Keeping the repository beside the
 * delivery record it commits with is what stops a second writer appearing
 * somewhere that does not know about the transaction.
 *
 * ## Which invariants that single writer may hold, and which it may not
 *
 * The distinction is worth stating, because "one writer" is easy to over-read
 * and the next person to add a second one needs to know what they are about to
 * break.
 *
 * **Held in the writer:** the SHAPE of a row — which columns a request may
 * influence at all, the reason allowlist, the details ceiling, the fact that
 * `reporter_oxy_user_id` comes from the session and never from a body. Those are
 * decisions about how a request is turned into a row, and one code path can
 * genuinely own them.
 *
 * **Held in the DATABASE:** "one OPEN report per reporter per property". That
 * one is NOT delegated to the writer, and single-writer is precisely the wrong
 * reason to think it could be — one writer means one code PATH, not one at a
 * time. That path runs concurrently with itself on every ECS task in the
 * service, so a read-then-insert inside it races exactly as badly as two
 * different writers would. `listing_reports_open_reporter_key` is a PARTIAL
 * unique index (`WHERE status = 'open'`), and {@link insertListingReport}
 * inserts against it and converges on `23505` rather than checking first.
 *
 * The partiality is load-bearing in its own right: once a report is resolved or
 * dismissed the same person must be able to file again if the listing is still
 * wrong, which a plain unique index would forbid forever.
 */

import { and, eq } from 'drizzle-orm';
import { getDb, inSavepoint, type DatabaseOrTransaction } from '../postgres';
import { listingReports } from '../schema/reports';
import { isUniqueViolation } from '../uniqueViolation';

export type ListingReportRow = typeof listingReports.$inferSelect;
export type ListingReportInsert = typeof listingReports.$inferInsert;

/** This reporter already has an OPEN report against this listing. */
export class DuplicateListingReportError extends Error {
  readonly existing: ListingReportRow;

  constructor(existing: ListingReportRow) {
    super('This listing has already been reported by this reporter.');
    this.name = 'DuplicateListingReportError';
    this.existing = existing;
  }
}

/** The OPEN report this reporter filed about this listing, if there is one. */
export async function findOpenListingReport(
  propertyId: string,
  reporterOxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ListingReportRow | undefined> {
  const [row] = await db
    .select()
    .from(listingReports)
    .where(
      and(
        eq(listingReports.propertyId, propertyId),
        eq(listingReports.reporterOxyUserId, reporterOxyUserId),
        eq(listingReports.status, 'open'),
      ),
    )
    .limit(1);
  return row;
}

/**
 * File a report against a listing.
 *
 * @throws {DuplicateListingReportError} From the partial unique index's own
 *   `23505`, carrying the existing open row so the caller can answer with it.
 */
export async function insertListingReport(
  db: DatabaseOrTransaction,
  values: ListingReportInsert,
): Promise<ListingReportRow> {
  try {
    // In its own SAVEPOINT, so a conflict leaves the caller's transaction
    // usable for the recovery read below — see `inSavepoint`.
    const [row] = await inSavepoint(db, (tx) =>
      tx.insert(listingReports).values(values).returning(),
    );
    return row;
  } catch (error) {
    if (!isUniqueViolation(error, 'listing_reports_open_reporter_key')) throw error;
    const existing = await findOpenListingReport(
      values.propertyId,
      values.reporterOxyUserId,
      db,
    );
    // The index refused the insert, so a row satisfying it existed at that
    // instant. Not finding it now means it was resolved in between — a real
    // state, and one the caller must not be handed a fabricated row for.
    if (!existing) throw error;
    throw new DuplicateListingReportError(existing);
  }
}
