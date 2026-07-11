/**
 * Immowelt provider — SERP card JSON fixture → normalize (pure).
 */

import {
  ImmoweltProvider,
  parseImmoweltCard,
  parseImmoweltSearch,
  parseImmoweltDetail,
  immoweltSourceIdFromUrl,
  IMMOWELT_FIXTURE_CARD_JSON,
  IMMOWELT_FIXTURE_SEARCH_HTML,
  IMMOWELT_FIXTURE_DETAIL_HTML,
  IMMOWELT_FIXTURE_DETAIL_HIDDEN_HTML,
  IMMOWELT_FIXTURE_DETAIL_URL,
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

  // Regression: the live 2025+ `/expose/{uuid}` detail page serves the listing in
  // the SSR blob `window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse("…")` →
  // `app_cldp.data.classified`, NOT the SERP `classified-serp-init-data`. The old
  // detail parser only looked for the SERP blob and failed every fetch with
  // "no classified JSON". Fixtures are real payloads captured from live pages.
  it('parses the SSR lifecycle blob on a published-address detail page', () => {
    const payload = parseImmoweltDetail(IMMOWELT_FIXTURE_DETAIL_HTML, IMMOWELT_FIXTURE_DETAIL_URL);
    expect(payload.sourceId).toBe('00b915d7-1122-40d0-a68d-916854f75987');
    expect(payload.price).toBe(499000);
    expect(payload.currency).toBe('EUR');
    expect(payload.operation).toBe('sale');
    expect(payload.address.city).toBe('Sommerhausen');
    expect(payload.address.street).toBe('Ochsenfurter Straße 10');
    expect(payload.address.postalCode).toBe('97286');
    expect(payload.address.state).toBe('Bavaria');
    expect(payload.address.coordinates).toEqual({
      lat: 49.70295715332031,
      lng: 10.024897575378418,
    });
    expect(payload.bedrooms).toBe(3);
    expect(payload.squareMeters).toBeCloseTo(79.8);
    expect(payload.images).toHaveLength(2);
    expect(payload.contact?.phone).toMatch(/093135901968/);
    expect(payload.contact?.agencyName).toMatch(/Spanheimer Wohnbau/i);
    expect(payload.contact?.name).toMatch(/Ralf Spanheimer/i);
    expect(payload.contact?.kind).toBe('agency');
  });

  it('normalizes a detail payload into a published DE sale listing with coords', () => {
    const payload = parseImmoweltDetail(IMMOWELT_FIXTURE_DETAIL_HTML, IMMOWELT_FIXTURE_DETAIL_URL);
    const ref: ExternalListingRef = {
      provider: 'immowelt',
      sourceId: payload.sourceId,
      url: payload.url,
    };
    const listing = provider.normalize({ ref, payload });
    expect(listing.status).toBe('published');
    expect(listing.offerings).toEqual([OfferingType.SALE]);
    expect(listing.sale?.price).toBe(499000);
    expect(listing.sale?.currency).toBe('EUR');
    expect(listing.longTermRent).toBeUndefined();
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.address.city).toBe('Sommerhausen');
    expect(listing.address.state).toBe('Bavaria');
    expect(listing.address.countryCode).toBe('DE');
    expect(listing.address.coordinates?.lat).toBeCloseTo(49.70295, 4);
    expect(listing.address.coordinates?.lng).toBeCloseTo(10.02489, 4);
    expect(listing.contact?.agencyName).toMatch(/Spanheimer Wohnbau/i);
  });

  it('skips coordinates when the detail geometry is a district MultiPolygon', () => {
    const payload = parseImmoweltDetail(
      IMMOWELT_FIXTURE_DETAIL_HIDDEN_HTML,
      'https://www.immowelt.de/expose/0006bab0-7f77-4be5-b15f-fefc5a01ec6b',
    );
    expect(payload.sourceId).toBe('0006bab0-7f77-4be5-b15f-fefc5a01ec6b');
    expect(payload.price).toBe(363000);
    expect(payload.operation).toBe('sale');
    expect(payload.address.city).toBe('Chamerau');
    expect(payload.address.street).toBeUndefined();
    expect(payload.address.coordinates).toBeUndefined();

    // Address hidden → normalize falls the street back to the city, never throws.
    const ref: ExternalListingRef = {
      provider: 'immowelt',
      sourceId: payload.sourceId,
      url: payload.url,
    };
    const listing = provider.normalize({ ref, payload });
    expect(listing.address.city).toBe('Chamerau');
    expect(listing.address.street).toBe('Chamerau');
    expect(listing.address.coordinates).toBeUndefined();
  });

  it('throws a precise reason when neither detail blob is present', () => {
    expect(() =>
      parseImmoweltDetail('<html><body>no data here</body></html>', IMMOWELT_FIXTURE_DETAIL_URL),
    ).toThrow(/__UFRN_LIFECYCLE_SERVERREQUEST__/);
  });
});
