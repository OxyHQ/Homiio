import type { TFunction } from 'i18next';

import { type Property } from '@homiio/shared-types';

import { resolvePrimaryOffering, type RentalMode } from './propertyUtils';

/**
 * The display-ready headline price + subtitle for a property detail surface.
 *
 * `priceLabel` is the formatted headline (e.g. `€1200/month`, `$350000`, or the
 * "Free" exchange label); `priceSubtitle` is the listing location
 * (`"City, Country"`). Both feed the sticky property header, the desktop
 * StickyBookingCard (right column), and the PropertyBookingWidget.
 */
export interface HeadlinePrice {
  priceLabel: string;
  priceSubtitle: string;
}

/**
 * Resolve the headline price + subtitle a property detail surface should show.
 *
 * Centralises the detail screen's price decision so the screen, the right-column
 * booking widget, and any future surface share one rule:
 *
 *  - The per-unit suffix derives from the stored `priceUnit`, falling back to a
 *    `paymentFrequency` mapping (daily → day, weekly → week, monthly → month),
 *    else `month`.
 *  - `resolvePrimaryOffering` (rent → sale → exchange) picks the offering: a
 *    sale listing shows its asking price (no per-unit suffix), an exchange
 *    listing shows the injected "Free" label, and rent keeps its exact
 *    `${currency}${amount}/${priceUnit}` display.
 *
 * `t` is injected so this helper stays UI-agnostic (it only reads the
 * `listing.exchange.free` label for the exchange fallback).
 */
export function resolveHeadlinePrice(
  property: Property,
  mode: RentalMode,
  t: TFunction,
): HeadlinePrice {
  const currency = property.rent?.currency || '⊜';

  let priceUnit: 'day' | 'night' | 'week' | 'month' | 'year' = 'month';
  if (property.priceUnit) {
    priceUnit = property.priceUnit;
  } else if (property.rent?.paymentFrequency) {
    switch (property.rent.paymentFrequency) {
      case 'daily':
        priceUnit = 'day';
        break;
      case 'weekly':
        priceUnit = 'week';
        break;
      case 'monthly':
        priceUnit = 'month';
        break;
      default:
        priceUnit = 'month';
    }
  }

  const offering = resolvePrimaryOffering(
    property,
    mode,
    t('listing.exchange.free', 'Free'),
  );

  let priceLabel: string;
  if (offering.kind === 'exchange') {
    priceLabel = offering.label;
  } else if (offering.kind === 'sale') {
    priceLabel = offering.amount > 0 ? `${offering.currency}${offering.amount}` : '';
  } else {
    priceLabel = property.rent ? `${currency}${property.rent.amount}/${priceUnit}` : '';
  }

  const priceSubtitle = `${property.address?.city || ''}, ${property.address?.country || ''}`;

  return { priceLabel, priceSubtitle };
}
