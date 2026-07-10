/**
 * Canada / Australia / UAE listing providers — Realtor.ca / realestate.com.au / Bayut.
 */

import {
  BayutProvider,
  BAYUT_FIXTURE_DETAIL_HTML,
  BAYUT_FIXTURE_SEARCH_HTML,
  RealtorCaProvider,
  REALTOR_CA_FIXTURE_DETAIL_JSON,
  REALTOR_CA_FIXTURE_SEARCH_JSON,
  RealestateComAuProvider,
  REALESTATE_COM_AU_FIXTURE_DETAIL_HTML,
  REALESTATE_COM_AU_FIXTURE_SEARCH_HTML,
  parseBayutDetail,
  parseBayutSearch,
  parseRealtorCaDetail,
  parseRealtorCaSearch,
  parseRealestateComAuDetail,
  parseRealestateComAuSearch,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

describe('RealtorCaProvider', () => {
  const provider = new RealtorCaProvider();

  it('declares CA market and parses search JSON', () => {
    expect(provider.id).toBe('realtor_ca');
    expect(provider.markets).toEqual(['CA']);
    const refs = parseRealtorCaSearch(REALTOR_CA_FIXTURE_SEARCH_JSON, 'rent');
    expect(refs.map((ref) => ref.sourceId)).toEqual(['29767355']);
    expect(refs[0]?.kind).toBe('rent');
  });

  it('normalizes detail with agency contact', () => {
    const payload = parseRealtorCaDetail(
      REALTOR_CA_FIXTURE_DETAIL_JSON,
      'https://www.realtor.ca/real-estate/29767355/1201-81-wellesley-street-e-toronto',
    );
    const listing = provider.normalize({
      ref: { provider: 'realtor_ca', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('realtor_ca');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(2800);
    expect(listing.longTermRent?.currency).toBe('CAD');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.address.countryCode).toBe('CA');
    expect(listing.contact?.phone).toContain('416');
    expect(listing.contact?.agencyName).toBe('Example Realty Inc.');
  });
});

describe('RealestateComAuProvider', () => {
  const provider = new RealestateComAuProvider();

  it('declares AU market and parses ArgonautExchange search', () => {
    expect(provider.markets).toEqual(['AU']);
    const refs = parseRealestateComAuSearch(REALESTATE_COM_AU_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['143029712', '143160680']);
    expect(refs.find((ref) => ref.sourceId === '143029712')?.kind).toBe('rent');
    expect(refs.find((ref) => ref.sourceId === '143160680')?.kind).toBe('sale');
  });

  it('normalizes rent detail with lister phone', () => {
    const payload = parseRealestateComAuDetail(
      REALESTATE_COM_AU_FIXTURE_DETAIL_HTML,
      'https://www.realestate.com.au/property-house-vic-wollert-143029712',
    );
    const listing = provider.normalize({
      ref: { provider: 'realestate_com_au', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('realestate_com_au');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(620);
    expect(listing.longTermRent?.currency).toBe('AUD');
    expect(listing.type).toBe(PropertyType.HOUSE);
    expect(listing.contact?.phone).toBe('0466229631');
    expect(listing.contact?.agencyName).toBe('Carvera Property');
  });
});

describe('BayutProvider', () => {
  const provider = new BayutProvider();

  it('declares AE market and parses __NEXT_DATA__ search', () => {
    expect(provider.markets).toEqual(['AE']);
    const refs = parseBayutSearch(BAYUT_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['7891234', '7891235']);
    expect(refs.find((ref) => ref.sourceId === '7891234')?.kind).toBe('rent');
    expect(refs.find((ref) => ref.sourceId === '7891235')?.kind).toBe('sale');
  });

  it('normalizes yearly rent to monthly AED with agent contact', () => {
    const payload = parseBayutDetail(
      BAYUT_FIXTURE_DETAIL_HTML,
      'https://www.bayut.com/property/details-7891234.html',
    );
    const listing = provider.normalize({
      ref: { provider: 'bayut', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('bayut');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(Math.round(95000 / 12));
    expect(listing.longTermRent?.currency).toBe('AED');
    expect(listing.address.city).toBe('Dubai');
    expect(listing.contact?.phone).toBe('+971501234567');
    expect(listing.contact?.agencyName).toBe('Premium Properties LLC');
  });
});
