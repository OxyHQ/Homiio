/**
 * pisos.com provider contract test (pure — no DB, no network).
 */

import {
  PisosProvider,
  parsePisosDetail,
  parsePisosSearch,
  parsePisosContactPhone,
  pisosSourceIdFromUrl,
  PISOS_FIXTURE_DETAIL_HTML,
  PISOS_FIXTURE_SEARCH_HTML,
  PISOS_FIXTURE_CONTACT_JSON,
} from '@homiio/listing-providers';
import type { ExternalListingRef } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new PisosProvider();

describe('PisosProvider.normalize', () => {
  it('maps embedded detail JSON into a published long-term-rent listing with contact', () => {
    const payload = parsePisosDetail(
      PISOS_FIXTURE_DETAIL_HTML,
      'https://www.pisos.com/alquilar/piso-sol_barrio28012-20026385030_992099/',
    );
    const ref: ExternalListingRef = { provider: 'pisos', sourceId: payload.sourceId, url: payload.url };
    const listing = provider.normalize({ ref, payload });

    expect(listing.source).toBe('pisos');
    expect(listing.sourceId).toBe('20026385030.992099');
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(2550);
    expect(listing.bedrooms).toBe(2);
    expect(listing.bathrooms).toBe(2);
    expect(listing.squareFootage).toBe(107);
    expect(listing.contact?.phone).toBe('919376345');
    expect(listing.contact?.kind).toBe('agency');
  });

  it('parses contact AJAX JSON', () => {
    expect(parsePisosContactPhone(PISOS_FIXTURE_CONTACT_JSON)).toBe('+34919376345');
  });
});

describe('PisosProvider search + helpers', () => {
  it('parses de-duplicated JSON-LD refs from a search page', () => {
    const refs = parsePisosSearch(PISOS_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBe(3);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual([
      '20026385030.992099',
      '61688075258.280500',
      '65072508446.519513',
    ]);
  });

  it('extracts a source id from a detail url', () => {
    expect(
      pisosSourceIdFromUrl('https://www.pisos.com/alquilar/piso-sol_barrio28012-20026385030_992099/'),
    ).toBe('20026385030.992099');
  });
});
