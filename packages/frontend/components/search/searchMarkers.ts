/**
 * Map pins for a result set — the projection, and nothing else.
 *
 * Its own module rather than a helper inside `SearchResultsView` for two
 * reasons, and the second is the one that matters: the results view imports the
 * map component, which imports `react-native-webview`, which needs a native
 * module no test environment has. A pure rule that cannot be unit-tested is a
 * pure rule nobody checks.
 */
import { formatMoney, type OfferingType, type Property } from '@homiio/shared-types';

import { resolvePrimaryOffering, toPriceDescriptor } from '@/utils/propertyUtils';
import type { Formatting } from '@/utils/format';
import { browseModeFromOffering } from './types';

/** A price pin: where it goes, and what it says. */
export interface MapMarker {
  id: string;
  coordinates: [number, number];
  priceLabel: string;
}

/**
 * Build map markers ([lng, lat] pins) from a property list.
 *
 * The pin label used to be `€${Math.round(amount).toLocaleString()}` — a euro
 * sign on every marker in the catalogue, whatever the listing was priced in, and
 * grouped in the DEVICE's locale rather than the reader's. It now goes through
 * the shared formatter, so a Polish listing shows złoty and a Romanian one lei.
 *
 * Markers stay whole-unit (`maximumFractionDigits: 0`): a pin is a few
 * characters wide and `1.234,56 €` does not fit in one.
 *
 * ## The marker set is a SUBSET of the card set, and the screen says so
 *
 * A listing whose address carries no coordinates cannot be drawn, so it is
 * dropped here and kept in the list — the right call, because it is a real
 * home somebody can rent. What is NOT acceptable is doing it silently: the map
 * then shows fewer homes than the heading counts, which reads as a map that has
 * not finished loading. The caller renders the difference (see
 * `unmappableCount`). Exported so the subset property has a test of its own.
 */
export function toMarkers(
  properties: readonly Property[],
  offering: OfferingType,
  formatting: Formatting,
): MapMarker[] {
  const browseMode = browseModeFromOffering(offering);
  return properties
    .map((p) => {
      const coords = p.address?.coordinates?.coordinates ?? p.location?.coordinates;
      if (
        !coords ||
        coords.length !== 2 ||
        typeof coords[0] !== 'number' ||
        typeof coords[1] !== 'number'
      ) {
        return null;
      }
      // Price the pin off the ACTIVE offering's block (monthly / nightly / sale).
      const primary = resolvePrimaryOffering(p, browseMode);
      const price = toPriceDescriptor(primary);
      const priceLabel = price
        ? formatMoney(price.amount, price.currency, formatting.locale, {
            maximumFractionDigits: 0,
          })
        : primary.label;
      return {
        id: p.id,
        coordinates: [coords[0], coords[1]] as [number, number],
        priceLabel,
      };
    })
    .filter((marker): marker is MapMarker => marker !== null);
}
