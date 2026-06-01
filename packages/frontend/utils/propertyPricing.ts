import type { TFunction } from 'i18next';

import { type Property } from '@homiio/shared-types';

import type { BrowseMode } from '@/components/search/types';
import { resolvePrimaryOffering } from './propertyUtils';

/**
 * The display-ready headline price + subtitle for a property detail surface.
 *
 * `priceLabel` is the formatted headline (e.g. `€1700/month`, `€110/night`,
 * `€350000`, or the "Free" exchange label); `priceSubtitle` is the listing
 * location (`"City, Country"`). Both feed the sticky property header, the
 * desktop BookingCard (right column), and the PropertyBookingWidget.
 */
export interface HeadlinePrice {
  priceLabel: string;
  priceSubtitle: string;
}

/** The per-unit suffix string shown after the rent amount in the headline. */
const PRICE_UNIT_SUFFIX: Record<'month' | 'night' | 'day' | 'week' | 'year', string> = {
  day: 'day',
  night: 'night',
  week: 'week',
  month: 'month',
  year: 'year',
};

/**
 * Resolve the headline price + subtitle a property detail surface should show
 * for the active {@link BrowseMode}.
 *
 * Centralises the detail screen's price decision so the screen, the right-column
 * booking widget, and any future surface share one rule. The unit is fixed per
 * priced block and never reinterpreted: {@link resolvePrimaryOffering} picks the
 * active offering's block — long-term shows `${currency}${amount}/month`,
 * short-term `${currency}${amount}/night`, sale the asking price (no suffix),
 * exchange the injected "Free" label.
 *
 * `t` is injected so this helper stays UI-agnostic (it only reads the
 * `listing.exchange.free` label for the exchange offering).
 */
export function resolveHeadlinePrice(
  property: Property,
  browseMode: BrowseMode,
  t: TFunction,
): HeadlinePrice {
  const offering = resolvePrimaryOffering(
    property,
    browseMode,
    t('listing.exchange.free', 'Free'),
  );

  let priceLabel: string;
  if (offering.kind === 'exchange') {
    priceLabel = offering.label;
  } else if (offering.kind === 'sale') {
    priceLabel = offering.amount > 0 ? `${offering.currency}${offering.amount}` : '';
  } else if (offering.amount > 0 && offering.priceUnit) {
    priceLabel = `${offering.currency}${offering.amount}/${PRICE_UNIT_SUFFIX[offering.priceUnit]}`;
  } else {
    priceLabel = '';
  }

  const priceSubtitle = `${property.address?.city || ''}, ${property.address?.country || ''}`;

  return { priceLabel, priceSubtitle };
}
