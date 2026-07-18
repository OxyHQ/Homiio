/**
 * OnTheMarket / OpenRent / Rightmove / Zoopla GB provider contract tests (fixtures only).
 */

import {
  NonHousingListingError,
  OnTheMarketProvider,
  OpenRentProvider,
  RightmoveProvider,
  ZooplaProvider,
  parseOnTheMarketDetail,
  parseOnTheMarketSearch,
  parseOpenRentDetail,
  parseOpenRentSearch,
  parseRightmoveDetail,
  parseRightmoveSearchJson,
  parseRightmoveTypeahead,
  parseZooplaDetail,
  parseZooplaSearch,
  ONTHEMARKET_FIXTURE_DETAIL_HTML,
  ONTHEMARKET_FIXTURE_GARAGE_HTML,
  ONTHEMARKET_FIXTURE_SEARCH_HTML,
  OPENRENT_FIXTURE_DETAIL_HTML,
  OPENRENT_FIXTURE_SEARCH_HTML,
  RIGHTMOVE_FIXTURE_DETAIL_HTML,
  RIGHTMOVE_FIXTURE_SEARCH_HTML,
  RIGHTMOVE_FIXTURE_TYPEAHEAD_JSON,
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
    expect(listing.contact?.whatsapp).toBe('442080227422');
  });

  it('rejects garage detail payloads', () => {
    expect(() =>
      parseOnTheMarketDetail(
        ONTHEMARKET_FIXTURE_GARAGE_HTML,
        'https://www.onthemarket.com/details/19890062/',
      ),
    ).toThrow(NonHousingListingError);
  });
});

describe('RightmoveProvider', () => {
  const provider = new RightmoveProvider();

  it('parses typeahead, filters garages from search, and normalizes __PAGE_MODEL detail', () => {
    expect(provider.markets).toEqual(['GB']);
    expect(parseRightmoveTypeahead(RIGHTMOVE_FIXTURE_TYPEAHEAD_JSON)).toBe('REGION^87490');

    const refs = parseRightmoveSearchJson(RIGHTMOVE_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['90551949', '90551951']);
    expect(refs.map((ref) => ref.sourceId)).not.toContain('90551950');

    const payload = parseRightmoveDetail(
      RIGHTMOVE_FIXTURE_DETAIL_HTML,
      'https://www.rightmove.co.uk/properties/90551949',
    );
    const listing = provider.normalize({
      ref: { provider: 'rightmove', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('rightmove');
    expect(listing.longTermRent?.monthlyAmount).toBe(3400);
    expect(listing.address.postalCode).toBe('SE1 9JF');
    expect(listing.address.coordinates).toEqual({ lat: 51.506931, lng: -0.10097 });
    expect(listing.contact?.phone).toContain('020');
    expect(listing.remoteImages.length).toBeGreaterThan(0);
    // sizings[] → squareFootage in m² (prefers the native sqm entry).
    expect(listing.squareFootage).toBe(79);
    // keyFeatures[] → canonical amenities (ingest derives hasGarden/hasBalcony/hasElevator/parking).
    expect(listing.amenities).toEqual(['garden', 'parking', 'balcony', 'elevator']);
    // letting.furnishType → furnishedStatus.
    expect(listing.furnishedStatus).toBe('furnished');
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
    expect(listing.address.postalCode).toBe('WC2N');
  });

  // The detail page has no `og:image`, so the `lightbox_item` gallery is the only
  // image source — and it appears TWICE: once for this property and again inside
  // the "similar properties" rail. Scraping both would attach other listings'
  // photos to this one.
  it('takes the gallery from the property set only, excluding similar properties', () => {
    const payload = parseOpenRentDetail(
      OPENRENT_FIXTURE_DETAIL_HTML,
      'https://www.openrent.co.uk/property-to-rent/london/1-bed-flat-london-wc2n/2865841',
    );

    expect(payload.images).toHaveLength(3);
    // Every image belongs to this listing's own CDN set.
    for (const url of payload.images) {
      expect(url).toContain('/listings/2493409/');
    }
    // The similar-properties set must not leak in.
    expect(payload.images.join(' ')).not.toContain('2434489');
    // Source markup is protocol-relative (`//imagescdn…`); stored URLs must be
    // absolute https or the media ingest cannot fetch them.
    for (const url of payload.images) {
      expect(url.startsWith('https://')).toBe(true);
    }
  });

  // OpenRent states area only as free text in the description ("721sq ft"), and
  // Homiio stores square METRES.
  it('converts the free-text square-footage in the description to square metres', () => {
    const payload = parseOpenRentDetail(
      OPENRENT_FIXTURE_DETAIL_HTML,
      'https://www.openrent.co.uk/property-to-rent/london/1-bed-flat-london-wc2n/2865841',
    );
    // 721 sq ft ≈ 66.98 m².
    expect(payload.squareMeters).toBe(67);
    // Bedrooms/bathrooms come from the `text-secondary-emphasis` summary strip.
    expect(payload.bedrooms).toBe(1);
    expect(payload.bathrooms).toBe(1);

    const listing = provider.normalize({
      ref: { provider: 'openrent', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    // The converted area must survive normalize — it was dropped before.
    expect(listing.squareFootage).toBe(67);
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
