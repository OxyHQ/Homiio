/**
 * Central/Western EU listing providers — Daft / Immoweb / Otodom / Funda.
 * Pure fixture tests; no live network.
 */

import {
  DaftProvider,
  parseDaftDetail,
  parseDaftSearch,
  DAFT_FIXTURE_DETAIL_HTML,
  DAFT_FIXTURE_SEARCH_HTML,
  ImmowebProvider,
  parseImmowebDetail,
  parseImmowebSearch,
  IMMOWEB_FIXTURE_DETAIL_JSON,
  IMMOWEB_FIXTURE_SEARCH_JSON,
  OtodomProvider,
  parseOtodomDetail,
  parseOtodomSearch,
  OTODOM_FIXTURE_DETAIL_HTML,
  OTODOM_FIXTURE_DETAIL_UNIFIED_HTML,
  OTODOM_FIXTURE_SEARCH_HTML,
  FundaProvider,
  parseFundaDetail,
  parseFundaSearch,
  FUNDA_FIXTURE_DETAIL_JSON,
  FUNDA_FIXTURE_SEARCH_JSON,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const daft = new DaftProvider();
const immoweb = new ImmowebProvider();
const otodom = new OtodomProvider();
const funda = new FundaProvider();

describe('DaftProvider (IE)', () => {
  it('parses search listings from __NEXT_DATA__', () => {
    const refs = parseDaftSearch(DAFT_FIXTURE_SEARCH_HTML, 'Dublin');
    expect(refs).toHaveLength(2);
    expect(refs[0].sourceId).toBe('6157730');
    expect(refs[0].kind).toBe('rent');
    expect(refs[1].kind).toBe('sale');
  });

  it('normalizes detail with agency contact', () => {
    const payload = parseDaftDetail(
      DAFT_FIXTURE_DETAIL_HTML,
      'https://www.daft.ie/for-rent/liberties-house-the-liberties-dublin-8/6157730',
      'Dublin',
    );
    const listing = daft.normalize({
      ref: { provider: 'daft', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('daft');
    expect(listing.address.countryCode).toBe('IE');
    expect(listing.longTermRent?.monthlyAmount).toBe(1850);
    expect(listing.contact?.agencyName).toBe('Daft Test Agency');
    expect(listing.type).toBe(PropertyType.APARTMENT);
  });
});

describe('ImmowebProvider (BE)', () => {
  it('parses search-results JSON', () => {
    const refs = parseImmowebSearch(IMMOWEB_FIXTURE_SEARCH_JSON);
    expect(refs).toHaveLength(2);
    expect(refs[0].sourceId).toBe('21703816');
    expect(refs[0].kind).toBe('rent');
    expect(refs[1].kind).toBe('sale');
  });

  it('normalizes classified detail with phone contact', () => {
    const payload = parseImmowebDetail(IMMOWEB_FIXTURE_DETAIL_JSON, '21703816');
    const listing = immoweb.normalize({
      ref: { provider: 'immoweb', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('immoweb');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1250);
    expect(listing.contact?.phone).toContain('3224505656');
    expect(listing.squareFootage).toBe(62);
    // bathroomCount (1) + showerRoomCount (1)
    expect(listing.bathrooms).toBe(2);
    // constructionYear lives on property.building, not the unit
    expect(listing.yearBuilt).toBe(1965);
    // amenities built from the true `has*` flags, mapped to canonical slugs
    expect(listing.amenities).toBeDefined();
    expect(listing.amenities).toEqual(
      expect.arrayContaining(['elevator', 'terrace', 'garden', 'storage', 'laundry', 'internet']),
    );
    expect(listing.hasElevator).toBe(true);
    expect(listing.hasGarden).toBe(true);
    expect(listing.hasBalcony).toBe(true);
    expect(listing.parkingSpaces).toBe(1);
    expect(listing.parkingType).toBe('garage');
    expect(listing.furnishedStatus).toBe('furnished');
  });
});

describe('OtodomProvider (PL)', () => {
  it('parses searchAds items from __NEXT_DATA__', () => {
    const refs = parseOtodomSearch(OTODOM_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs[0].sourceId).toBe('67155161');
  });

  it('rebuilds canonical /pl/oferta/<slug> URLs from `[lang]/ad/` hrefs', () => {
    const refs = parseOtodomSearch(OTODOM_FIXTURE_SEARCH_HTML);
    // The portal `href` is a `[lang]/ad/<slug>` template whose path 404s; the
    // discover ref must point at the canonical detail URL that actually resolves.
    expect(refs[0].url).toBe(
      'https://www.otodom.pl/pl/oferta/bez-prowizji-2-pokoje-ul-bunscha-ID4xM7L',
    );
    for (const ref of refs) {
      expect(ref.url).toMatch(/^https:\/\/www\.otodom\.pl\/pl\/oferta\/[^/]+$/);
      expect(ref.url).not.toContain('/ad/');
    }
  });

  it('normalizes detail with contact phones', () => {
    const payload = parseOtodomDetail(
      OTODOM_FIXTURE_DETAIL_HTML,
      'https://www.otodom.pl/pl/oferta/bez-prowizji-2-pokoje-ul-bunscha-ID4xM7L',
    );
    const listing = otodom.normalize({
      ref: { provider: 'otodom', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('otodom');
    expect(listing.address.countryCode).toBe('PL');
    expect(listing.contact?.phone).toContain('48698089999');
    expect(listing.longTermRent?.monthlyAmount).toBe(2900);
    expect(listing.bedrooms).toBe(2);
  });

  it('resolves price from unifiedAd/characteristics (current markup, no ad.totalPrice)', () => {
    const payload = parseOtodomDetail(
      OTODOM_FIXTURE_DETAIL_UNIFIED_HTML,
      'https://www.otodom.pl/pl/oferta/mieszkanie-2-pokojowe-skorosze-ID4CamF',
    );
    const listing = otodom.normalize({
      ref: { provider: 'otodom', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('otodom');
    expect(listing.offerings).toContain(OfferingType.LONG_TERM_RENT);
    expect(listing.longTermRent?.monthlyAmount).toBe(3650);
    expect(listing.longTermRent?.currency).toBe('PLN');
    expect(listing.bedrooms).toBe(2);
    expect(listing.squareFootage).toBe(38);
    expect(listing.address.city).toBe('Warszawa');
    expect(listing.address.coordinates?.lat).toBeCloseTo(52.188404, 4);
    expect(listing.remoteImages.length).toBe(2);
    expect(listing.contact?.phone).toContain('48733806496');
  });
});

describe('FundaProvider (NL)', () => {
  it('parses msearch hits JSON', () => {
    const refs = parseFundaSearch(FUNDA_FIXTURE_SEARCH_JSON);
    expect(refs).toHaveLength(2);
    expect(refs[0].sourceId).toBe('43117443');
    expect(refs[0].kind).toBe('rent');
    expect(refs[1].kind).toBe('sale');
  });

  it('normalizes detail JSON with broker contact', () => {
    const payload = parseFundaDetail(FUNDA_FIXTURE_DETAIL_JSON, '43117443');
    const listing = funda.normalize({
      ref: { provider: 'funda', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('funda');
    expect(listing.address.countryCode).toBe('NL');
    expect(listing.longTermRent?.monthlyAmount).toBe(1850);
    expect(listing.contact?.phone).toContain('31201234567');
    expect(listing.squareFootage).toBe(72);
  });
});
