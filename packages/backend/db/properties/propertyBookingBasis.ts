/**
 * The property columns every booking path asks about.
 *
 * `is this listing bookable at all?` (`status`, `is_external`, `offerings`) and
 * `who owns it?` (`oxy_user_id`) — asked by `viewingController`,
 * `applicationController` and `reservationController` before they will create
 * anything.
 *
 * ## Why this is not `findPropertyById`
 *
 * `db/properties/propertyReads.ts` hydrates a listing with its address, geo
 * names, photos, documents and calendar, because it exists to build a listing
 * RESPONSE. A booking path builds no such response — it answers a yes/no and
 * then writes its own row — so hydrating one would make every viewing request
 * pay for a page render it discards.
 *
 * It is equally NOT a second serializer, which is the line that matters: nothing
 * here reshapes a property for the wire, so
 * `db/properties/propertySerializer.ts` stays the single authority on what a
 * listing looks like to a client. A booking path that needs to SHOW a listing
 * must go through that module, not widen this one.
 *
 * It lives under `db/properties/` rather than beside its callers because the
 * columns are the property domain's, and one projection three controllers share
 * is what stops three of them drifting on what "bookable" means.
 */

import { eq } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import { properties } from '../schema';

/** The booking-relevant facts about a listing. */
export interface PropertyBookingBasis {
  readonly id: string;
  /** `PropertyStatus`; a booking path compares it against `published`. */
  readonly status: string;
  /** External listings have no in-app apply, viewing or booking. */
  readonly isExternal: boolean;
  /**
   * The owner, or NULL.
   *
   * Nullable because the `pre('save')` hook that sets `expires_at` on an
   * external listing STRIPS the owner — so "external" and "ownerless" are
   * closely related states, and a caller has to handle the null rather than
   * assume a listing has somebody behind it.
   */
  readonly oxyUserId: string | null;
  /**
   * Which markets the listing is offered in (`long_term_rent`, …).
   *
   * `applicationController` refuses an application to a listing that is not
   * offered for long-term rent, and `reservationController` asks the same
   * question about short-term. The `properties_offerings_*` CHECKs make this
   * exactly the set of present priced blocks, so it is a reliable answer rather
   * than a hint.
   */
  readonly offerings: readonly string[];
  /**
   * Which exchange the listing accepts (`swap` | `host` | `both`), or NULL.
   *
   * Nullable because `exchange` is an OPTIONAL priced block — a listing not
   * open to home exchange simply has none, which is why
   * `exchangeController` treats a missing mode as a refusal rather than a
   * default.
   */
  readonly exchangeMode: string | null;

  // ── the short-term block, for `reservationController` ──
  //
  // Every column is nullable because `short_term_rent` is an OPTIONAL priced
  // block: `properties_offerings_short_term_rent_check` makes the offering
  // exactly the presence of `nightly_rate`, so a listing not offered for short
  // stays has the whole block NULL rather than zeroed. A caller must treat the
  // null as "not bookable", never as a free stay.
  readonly maxGuests: number;
  readonly cancellationPolicy: string | null;
  readonly shortTermRentNightlyRate: number | null;
  readonly shortTermRentCurrency: string | null;
  readonly shortTermRentCleaningFee: number | null;
  readonly shortTermRentServiceFee: number | null;
  readonly shortTermRentTaxesPercent: number | null;
  readonly shortTermRentMinNights: number | null;
  readonly shortTermRentMaxNights: number | null;
  readonly shortTermRentInstantBook: boolean | null;
}

/** The columns above, declared once so the read and the LOCKED read agree. */
const BOOKING_BASIS_COLUMNS = {
  id: properties.id,
  status: properties.status,
  isExternal: properties.isExternal,
  oxyUserId: properties.oxyUserId,
  offerings: properties.offerings,
  exchangeMode: properties.exchangeMode,
  maxGuests: properties.maxGuests,
  cancellationPolicy: properties.cancellationPolicy,
  shortTermRentNightlyRate: properties.shortTermRentNightlyRate,
  shortTermRentCurrency: properties.shortTermRentCurrency,
  shortTermRentCleaningFee: properties.shortTermRentCleaningFee,
  shortTermRentServiceFee: properties.shortTermRentServiceFee,
  shortTermRentTaxesPercent: properties.shortTermRentTaxesPercent,
  shortTermRentMinNights: properties.shortTermRentMinNights,
  shortTermRentMaxNights: properties.shortTermRentMaxNights,
  shortTermRentInstantBook: properties.shortTermRentInstantBook,
} as const;

/**
 * The same basis, read `FOR UPDATE` — the lock every booking decision needs.
 *
 * ## Why the PROPERTY row is what gets locked
 *
 * A booking path reads the calendar, decides the home is free, and inserts. The
 * row it is deciding against does not exist yet, so there is nothing else to
 * lock: two requests for the same nights both read an empty calendar and both
 * write. Locking the `properties` row makes every commitment against one home
 * serialise — the second request waits, then re-reads a calendar that now
 * contains the first — and it is also the row whose PRICE and CAPACITY the
 * decision is made from, so the quote cannot be computed from a version of the
 * listing that no longer exists by the time the row lands.
 *
 * ## The ids are locked in sorted order, and that is not cosmetic
 *
 * A swap commits TWO homes. Two swaps in opposite directions — A offering for
 * B's home while B offers for A's — would each hold one row and wait for the
 * other forever; Postgres breaks the tie by killing one with `40P01`. Sorting
 * the ids gives every caller the same acquisition order, which is what makes
 * that deadlock unreachable rather than merely unlikely.
 *
 * Duplicates are collapsed, so naming the same home twice is not an error.
 *
 * @returns The locked rows by id. An id that names nothing is simply absent —
 *   the caller answers 404 from that, exactly as it does for an unlocked read.
 */
export async function lockPropertyBookingBases(
  tx: DatabaseOrTransaction,
  propertyIds: readonly string[],
): Promise<Map<string, PropertyBookingBasis>> {
  const ordered = [...new Set(propertyIds)].sort();
  const locked = new Map<string, PropertyBookingBasis>();
  for (const propertyId of ordered) {
    const [row] = await tx
      .select(BOOKING_BASIS_COLUMNS)
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1)
      .for('update');
    if (row) locked.set(propertyId, row);
  }
  return locked;
}

/** The booking-relevant columns of one listing, or `undefined`. */
export async function findPropertyBookingBasis(
  db: DatabaseOrTransaction,
  propertyId: string,
): Promise<PropertyBookingBasis | undefined> {
  const [row] = await db
    .select(BOOKING_BASIS_COLUMNS)
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return row;
}
