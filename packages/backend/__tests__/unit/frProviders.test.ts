/**
 * France listing providers — fixture-only contract tests (no network).
 */

import {
  BieniciProvider,
  LeboncoinProvider,
  SelogerProvider,
  parseBieniciDetail,
  parseBieniciSearch,
  parseLeboncoinDetail,
  parseLeboncoinSearch,
  parseSelogerDetail,
  parseSelogerSearch,
  BIENICI_FIXTURE_DETAIL_JSON,
  BIENICI_FIXTURE_BUY_DETAIL_JSON,
  BIENICI_FIXTURE_SEARCH_JSON,
  LEBONCOIN_FIXTURE_DETAIL_JSON,
  LEBONCOIN_FIXTURE_FINDER_JSON,
  SELOGER_FIXTURE_DETAIL_HTML,
  SELOGER_FIXTURE_SEARCH_HTML,
  NonHousingListingError,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

describe('BieniciProvider', () => {
  const provider = new BieniciProvider();

  it('declares FR market', () => {
    expect(provider.markets).toEqual(['FR']);
    expect(provider.id).toBe('bienici');
  });

  it('parses priced search refs and skips redacted prices', () => {
    const refs = parseBieniciSearch(BIENICI_FIXTURE_SEARCH_JSON);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual([
      'ag750725-49688129',
      'nexity-57__57006',
    ]);
    expect(refs.find((ref) => ref.sourceId === 'ag750725-49688129')?.price).toBe(1850);
    expect(refs.find((ref) => ref.sourceId === 'nexity-57__57006')?.price).toBe(275000);
  });

  it('normalizes rent detail with agency phone contact', () => {
    const payload = parseBieniciDetail(
      BIENICI_FIXTURE_DETAIL_JSON,
      'https://www.bienici.com/annonce/location/ag750725-49688129',
    );
    const listing = provider.normalize({
      ref: { provider: 'bienici', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('bienici');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1850);
    expect(listing.longTermRent?.currency).toBe('EUR');
    expect(listing.address.countryCode).toBe('FR');
    expect(listing.contact?.phone).toContain('014329');
    expect(listing.contact?.agencyName).toBe('AKOUN PROPRIETES');
    expect(listing.remoteImages.length).toBeGreaterThan(0);
  });

  it('uses search price hint when detail redacts price', () => {
    const payload = parseBieniciDetail(
      BIENICI_FIXTURE_BUY_DETAIL_JSON,
      'https://www.bienici.com/annonce/achat/nexity-57__57006',
      275000,
    );
    const listing = provider.normalize({
      ref: { provider: 'bienici', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.offerings).toEqual([OfferingType.SALE]);
    expect(listing.sale?.price).toBe(275000);
    expect(listing.contact?.agencyName).toBe('Nexity');
  });
});

describe('LeboncoinProvider', () => {
  const provider = new LeboncoinProvider();

  it('declares FR and filters housing categories only', () => {
    expect(provider.markets).toEqual(['FR']);
    const refs = parseLeboncoinSearch(LEBONCOIN_FIXTURE_FINDER_JSON);
    expect(refs.map((ref) => ref.sourceId)).toEqual(['2654321098']);
    expect(refs.map((ref) => ref.sourceId)).not.toContain('2654321099');
  });

  it('normalizes housing detail with contact', () => {
    const payload = parseLeboncoinDetail(
      LEBONCOIN_FIXTURE_DETAIL_JSON,
      'https://www.leboncoin.fr/ad/locations/2654321098',
    );
    const listing = provider.normalize({
      ref: { provider: 'leboncoin', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('leboncoin');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.longTermRent?.monthlyAmount).toBe(1650);
    expect(listing.contact?.phone).toContain('014455');
    expect(listing.contact?.agencyName).toBe('Agence Lumière');
    expect(listing.furnishedStatus).toBe('furnished');
  });

  it('rejects non-housing category detail', () => {
    const car = JSON.stringify({
      list_id: 1,
      category_id: '2',
      category_name: 'Voitures',
      subject: 'Peugeot',
      price: [5000],
      location: { city: 'Lyon', zipcode: '69001' },
    });
    expect(() => parseLeboncoinDetail(car, 'https://www.leboncoin.fr/ad/voitures/1')).toThrow(
      NonHousingListingError,
    );
  });
});

describe('SelogerProvider', () => {
  const provider = new SelogerProvider();

  it('parses initialData search cards and normalizes detail contact', () => {
    expect(provider.markets).toEqual(['FR']);
    const refs = parseSelogerSearch(SELOGER_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['201234567', '201234568']);

    const payload = parseSelogerDetail(
      SELOGER_FIXTURE_DETAIL_HTML,
      'https://www.seloger.com/annonces/locations/appartement/201234567.htm',
    );
    const listing = provider.normalize({
      ref: { provider: 'seloger', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.longTermRent?.monthlyAmount).toBe(1450);
    expect(listing.contact?.phone).toContain('014000');
    expect(listing.contact?.agencyName).toContain('Century 21');
  });
});
