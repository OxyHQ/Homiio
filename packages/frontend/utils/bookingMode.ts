/**
 * resolveBookingMode — the single decision for which action surface a property
 * detail shows beside the listing, given what the user is browsing.
 *
 * Centralised so the screen (mobile inline path), the `BookingCard`, the rail
 * widget and any future surface share ONE rule instead of re-deriving the same
 * booleans:
 *  - `'vacation'`   — browsing vacation rentals AND the listing carries the
 *                     {@link OfferingType.SHORT_TERM_RENT} offering.
 *  - `'sale'`       — browsing homes to buy AND the listing is for sale, or the
 *                     listing is ONLY for sale (whatever the mode: there is no
 *                     other surface it could show).
 *  - `'long_term'`  — browsing long-term AND the listing carries the
 *                     {@link OfferingType.LONG_TERM_RENT} offering.
 *  - `'none'`       — nothing applies (e.g. vacation mode on a listing with no
 *                     short-term offering), so no booking/apply surface shows.
 */
import { OfferingType, type Property } from '@homiio/shared-types';

import type { BrowseMode } from '@/components/search/types';
import { hasOffering, type RentalMode } from './propertyUtils';

export type BookingMode = 'vacation' | 'long_term' | 'sale' | 'none';

export function resolveBookingMode(
  property: Property,
  rentalMode: RentalMode,
  browseMode?: BrowseMode,
): BookingMode {
  const forSale = hasOffering(property, OfferingType.SALE);
  const longTerm = hasOffering(property, OfferingType.LONG_TERM_RENT);
  const shortTerm = hasOffering(property, OfferingType.SHORT_TERM_RENT);

  if (rentalMode === 'vacation' && shortTerm) return 'vacation';
  if (browseMode === 'buy' && forSale) return 'sale';
  if (rentalMode === 'long_term' && longTerm) return 'long_term';
  if (forSale && !longTerm && !shortTerm) return 'sale';
  return 'none';
}
