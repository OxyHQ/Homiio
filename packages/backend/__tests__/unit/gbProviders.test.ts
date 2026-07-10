/**
 * OnTheMarket / OpenRent / Zoopla GB provider contract tests (fixtures only).
 */

import {
  OnTheMarketProvider,
  OpenRentProvider,
  ZooplaProvider,
  parseOnTheMarketDetail,
  parseOnTheMarketSearch,
  parseOpenRentDetail,
  parseOpenRentSearch,
  parseZooplaDetail,
  parseZooplaSearch,
  ONTHEMARKET_FIXTURE_DETAIL_HTML,
  ONTHEMARKET_FIXTURE_GARAGE_HTML,
  ONTHEMARKET_FIXTURE_SEARCH_HTML,
  OPENRENT_FIXTURE_DETAIL_HTML,
  OPENRENT_FIXTURE_SEARCH_HTML,
  ZOOPLA_FIXTURE_DETAIL_HTML,
  ZOOPLA_FIXTURE_SEARCH_HTML,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

describe('OnTheMarketProvider', () => {
  const provider = new OnTheMarketProvider();

  it('declares GB and filters garages from search', () => {
    expect(provider.markets).toEqual(['GB']);
    const refs = parseOnTheMarketSearch(ONTHEMARKET_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId)).toEqual(expect.arrayContaining(['19901416', '19901417']));
    expect(refs.map((ref) => ref.sourceId)).not.toContain('19890062');
  });

  it('normalizes housing detail JSON with agency phone', () => {
    const payload = parseOnTheMarketDetail(
      ONTHEMARKET_FIXTURE_DETAIL_HTML,
      'https://www.onthemarket.com/details/19901416/',
    );
    const listing = provider.normalize({
      ref: { provider: 'onthemarket', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('onthemarket');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(5500);
    expect(listing.longTermRent?.currency).toBe('GBP');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.contact?.phone).toContain('020');
    expect(listing.contact?.whatsapp).toContain('wa.me');
  });

  it('rejects garage detail payloads', () => {
    expect(() =>
      parseOnTheMarketDetail(
        ONTHEMARKET_FIXTURE_GARAGE_HTML,
        'https://www.onthemarket.com/details/19890062/',
      ),
    ).toThrow(/non-housing/);
  });
});

describe('OpenRentProvider', () => {
  const provider = new OpenRentProvider();

  it('parses search refs and normalizes title rent + contact', () => {
    expect(provider.markets).toEqual(['GB']);
    const refs = parseOpenRentSearch(OPENRENT_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['2865841', '2870098']);

    const payload = parseOpenRentDetail(
      OPENRENT_FIXTURE_DETAIL_HTML,
      'https://www.openrent.co.uk/property-to-rent/london/1-bed-flat-london-wc2n/2865841',
    );
    const listing = provider.normalize({
      ref: { provider: 'openrent', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.longTermRent?.monthlyAmount).toBe(2750);
    expect(listing.bedrooms).toBe(1);
    expect(listing.contact?.phone).toContain('020');
    expect(listing.contact?.email).toBe('landlord@example.com');
    expect(listing.address.countryCode).toBe('GB');
  });
});

describe('ZooplaProvider', () => {
  const provider = new ZooplaProvider();

  it('parses housing search links and normalizes detail JSON contact', () => {
    expect(provider.markets).toEqual(['GB']);
    const refs = parseZooplaSearch(ZOOPLA_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId)).toContain('68451234');
    expect(refs.map((ref) => ref.sourceId)).not.toContain('68451235');

    const payload = parseZooplaDetail(
      ZOOPLA_FIXTURE_DETAIL_HTML,
      'https://www.zoopla.co.uk/to-rent/details/68451234/',
    );
    const listing = provider.normalize({
      ref: { provider: 'zoopla', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.longTermRent?.monthlyAmount).toBe(2200);
    expect(listing.contact?.phone).toContain('020');
    expect(listing.contact?.email).toBe('agency@example.com');
    expect(listing.contact?.agencyName).toMatch(/Zoopla Test/i);
  });
});
