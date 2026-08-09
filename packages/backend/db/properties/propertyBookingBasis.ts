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

/** The booking-relevant columns of one listing, or `undefined`. */
export async function findPropertyBookingBasis(
  db: DatabaseOrTransaction,
  propertyId: string,
): Promise<PropertyBookingBasis | undefined> {
  const [row] = await db
    .select({
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
    })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return row;
}
