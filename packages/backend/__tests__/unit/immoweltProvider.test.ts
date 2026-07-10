/**
 * Immowelt provider — SERP card JSON fixture → normalize (pure).
 */

import {
  ImmoweltProvider,
  parseImmoweltCard,
  parseImmoweltSearch,
  immoweltSourceIdFromUrl,
  IMMOWELT_FIXTURE_CARD_JSON,
  IMMOWELT_FIXTURE_SEARCH_HTML,
} from '@homiio/listing-providers';
import type { ExternalListingRef } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new ImmoweltProvider();

describe('ImmoweltProvider', () => {
  it('parses expose refs from search HTML', () => {
    const refs = parseImmoweltSearch(IMMOWELT_FIXTURE_SEARCH_HTML);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.sourceId).toBe('311aaa07-ac4a-477e-ba23-bb35a3754385');
  });

  it('normalizes card JSON into a published DE rent listing with contact', () => {
    const card = JSON.parse(IMMOWELT_FIXTURE_CARD_JSON) as Record<string, unknown>;
    const payload = parseImmoweltCard(card);
    const ref: ExternalListingRef = {
      provider: 'immowelt',
      sourceId: payload.sourceId,
      url: payload.url,
    };
    const listing = provider.normalize({ ref, payload });
    expect(listing.source).toBe('immowelt');
    expect(listing.sourceId).toBe('311aaa07-ac4a-477e-ba23-bb35a3754385');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1659);
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.address.city).toBe('Berlin');
    expect(listing.address.countryCode).toBe('DE');
    expect(listing.bedrooms).toBe(3);
    expect(listing.contact?.phone).toMatch(/49301234567/);
    expect(listing.contact?.email).toBe('kontakt@example-immowelt.de');
    expect(listing.contact?.agencyName).toMatch(/Stuck Immobilien/i);
  });

  it('derives source id from expose URL', () => {
    expect(
      immoweltSourceIdFromUrl(
        'https://www.immowelt.de/expose/311aaa07-ac4a-477e-ba23-bb35a3754385',
      ),
    ).toBe('311aaa07-ac4a-477e-ba23-bb35a3754385');
  });
});
