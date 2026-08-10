import type { TFunction } from 'i18next';

import { formatPrice, formatPriceLabel, type Property } from '@homiio/shared-types';

import type { BrowseMode } from '@/components/search/types';
import type { Formatting } from '@/utils/format';
import { resolvePrimaryOffering, toPriceDescriptor } from './propertyUtils';

/**
 * The display-ready headline price + subtitle for a property detail surface.
 *
 * `priceLabel` is the formatted headline (`1.700 € / mes`, `€110 / night`,
 * `€350,000`, or the "Free" exchange label); `priceAccessibilityLabel` is the
 * same figure spoken in full ("1700 euros per month") for `accessibilityLabel`;
 * `priceSubtitle` is the listing location (`"City, Country"`). All three feed the
 * sticky property header, the desktop BookingCard (right column), and the
 * PropertyBookingWidget.
 *
 * The money goes through the shared formatter, so the currency is the LISTING's
 * (never the locale's, never converted) and the separators and symbol position
 * are the reader's. It used to be `${offering.currency}${offering.amount}`,
 * which pasted the ISO CODE where a symbol belongs — `EUR1700/month`.
 */
export interface HeadlinePrice {
  priceLabel: string;
  priceAccessibilityLabel: string;
  priceSubtitle: string;
}

/**
 * Resolve the headline price + subtitle a property detail surface should show
 * for the active {@link BrowseMode}.
 *
 * Centralises the detail screen's price decision so the screen, the right-column
 * booking widget, and any future surface share one rule. The unit is fixed per
 * priced block and never reinterpreted: {@link resolvePrimaryOffering} picks the
 * active offering's block, and {@link toPriceDescriptor} carries that block's own
 * frequency through to the formatter.
 *
 * `t` is injected so this helper stays UI-agnostic (it only reads the
 * `listing.exchange.free` label for the exchange offering); `formatting` carries
 * the reader's locale and the translated unit words.
 */
export function resolveHeadlinePrice(
  property: Property,
  browseMode: BrowseMode,
  t: TFunction,
  formatting: Formatting,
): HeadlinePrice {
  const offering = resolvePrimaryOffering(
    property,
    browseMode,
    t('listing.exchange.free'),
  );
  const price = toPriceDescriptor(offering);
  const options = { unitLabels: formatting.priceUnitLabels };

  const priceLabel = price
    ? formatPrice(price, formatting.locale, options)
    : offering.kind === 'exchange'
      ? offering.label
      : '';
  const priceAccessibilityLabel = price
    ? formatPriceLabel(price, formatting.locale, options)
    : priceLabel;

  const priceSubtitle = `${property.address?.cityName || ''}, ${property.address?.countryName || ''}`;

  return { priceLabel, priceAccessibilityLabel, priceSubtitle };
}
