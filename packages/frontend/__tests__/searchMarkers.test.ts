/**
 * Markers come from the SAME set as the cards, and never from a different one.
 *
 * #354's mandatory case "marker without a matching card, card without
 * coordinates" is really two claims, and only one of them is a bug:
 *
 *  - **A marker with no card is incoherent.** The pins and the rows must be the
 *    same result set, or clicking a pin selects nothing and the map is showing
 *    homes the list denies exist. `toMarkers` is a projection of the loaded
 *    properties, so this is true by construction — and asserted here, because
 *    "by construction" stops being true the moment somebody fetches markers
 *    from a second endpoint.
 *  - **A card with no marker is legitimate and must be VISIBLE.** A listing
 *    whose address has no coordinates is a real home; dropping it from the list
 *    would hide it, and dropping it from the map silently makes the map look
 *    like it is still loading. It is kept in the list, left off the map, and
 *    counted, so the screen can say why the two differ.
 */
import { OfferingType, type Property } from '@homiio/shared-types';

import { toMarkers } from '@/components/search/searchMarkers';
import type { Formatting } from '@/utils/format';

const formatting = { locale: 'en-GB' } as Formatting;

/** A listing, with or without coordinates on its address. */
function listing(id: string, coordinates?: [number, number]): Property {
  return {
    id,
    longTermRent: { monthlyAmount: 1200, currency: 'EUR' },
    offerings: [OfferingType.LONG_TERM_RENT],
    ...(coordinates
      ? { address: { coordinates: { type: 'Point', coordinates } } }
      : { address: { street: 'Carrer Gran' } }),
  } as unknown as Property;
}

describe('toMarkers', () => {
  it('draws every listing that has coordinates', () => {
    const markers = toMarkers(
      [listing('a', [2.17, 41.38]), listing('b', [-3.7, 40.41])],
      OfferingType.LONG_TERM_RENT,
      formatting,
    );

    expect(markers.map((marker) => marker.id)).toEqual(['a', 'b']);
    expect(markers[0].coordinates).toEqual([2.17, 41.38]);
  });

  it('emits NO marker that has no card', () => {
    // The incoherent direction. Every marker id must exist in the property set
    // it was built from — a pin selecting nothing is a map describing a
    // different query.
    const properties = [listing('a', [2.17, 41.38]), listing('b')];
    const ids = new Set(properties.map((property) => property.id));

    for (const marker of toMarkers(properties, OfferingType.LONG_TERM_RENT, formatting)) {
      expect(ids.has(marker.id)).toBe(true);
    }
  });

  it('leaves a listing with no coordinates OFF the map and countable', () => {
    const properties = [listing('a', [2.17, 41.38]), listing('b'), listing('c')];
    const markers = toMarkers(properties, OfferingType.LONG_TERM_RENT, formatting);

    expect(markers.map((marker) => marker.id)).toEqual(['a']);
    // The difference the results header renders. Two homes are in the list and
    // not on the map, and the screen says so rather than leaving the reader to
    // notice a map that looks unfinished.
    expect(properties.length - markers.length).toBe(2);
  });

  it('refuses a coordinate pair that is not a pair of numbers', () => {
    // Ingested data is not trusted to be well formed. A `[null, null]` reaching
    // MapLibre throws inside the map rather than in this function, which is the
    // hardest place to attribute it from.
    const malformed = { id: 'x', address: { coordinates: { coordinates: ['2.17', null] } } };
    expect(
      toMarkers([malformed as unknown as Property], OfferingType.LONG_TERM_RENT, formatting),
    ).toEqual([]);
  });
});
