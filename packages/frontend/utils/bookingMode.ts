/**
 * resolveBookingMode — the single decision for which booking surface a
 * property detail should show, given the user's selected rental mode.
 *
 * Centralised so the screen (mobile inline path), the `BookingCard`, and any
 * future surface share ONE rule instead of re-deriving the same booleans:
 *  - `'vacation'`   — the user is browsing vacation rentals AND the listing
 *                     carries the {@link OfferingType.SHORT_TERM_RENT} offering.
 *  - `'long_term'`  — the user is browsing long-term AND the listing carries
 *                     the {@link OfferingType.LONG_TERM_RENT} offering.
 *  - `'none'`       — neither applies (e.g. vacation mode on a listing with no
 *                     short-term offering), so no booking/apply surface shows.
 */
import { OfferingType, type Property } from '@homiio/shared-types';

import { hasOffering, type RentalMode } from './propertyUtils';

export type BookingMode = 'vacation' | 'long_term' | 'none';

export function resolveBookingMode(
  property: Property,
  rentalMode: RentalMode,
): BookingMode {
  if (rentalMode === 'vacation' && hasOffering(property, OfferingType.SHORT_TERM_RENT)) {
    return 'vacation';
  }
  if (rentalMode === 'long_term' && hasOffering(property, OfferingType.LONG_TERM_RENT)) {
    return 'long_term';
  }
  return 'none';
}
