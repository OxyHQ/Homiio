/**
 * resolveBookingMode — the single decision for which booking surface a
 * property detail should show, given the user's selected rental mode.
 *
 * Centralised so the screen (mobile inline path), the `BookingCard`, and any
 * future surface share ONE rule instead of re-deriving the same booleans:
 *  - `'vacation'`   — the user is browsing vacation rentals AND the listing
 *                     supports short stays (rentMode VACATION or BOTH).
 *  - `'long_term'`  — the user is browsing long-term AND the listing is not
 *                     vacation-only (rentMode !== VACATION).
 *  - `'none'`       — neither applies (e.g. vacation mode on a long-term-only
 *                     listing), so no booking/apply surface is shown.
 */
import { RentMode, type Property } from '@homiio/shared-types';

import type { RentalMode } from './propertyUtils';

export type BookingMode = 'vacation' | 'long_term' | 'none';

export function resolveBookingMode(
  property: Property,
  rentalMode: RentalMode,
): BookingMode {
  if (
    rentalMode === 'vacation' &&
    (property.rentMode === RentMode.VACATION || property.rentMode === RentMode.BOTH)
  ) {
    return 'vacation';
  }
  if (rentalMode === 'long_term' && property.rentMode !== RentMode.VACATION) {
    return 'long_term';
  }
  return 'none';
}
