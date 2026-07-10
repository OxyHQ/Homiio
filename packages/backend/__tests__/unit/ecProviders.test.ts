/**
 * Ecuador listing providers — Plusvalía / MercadoLibre EC / Properati.
 * Pure fixture → parse → normalize (no network).
 */
import {
  PlusvaliaProvider,
  PLUSVALIA_FIXTURE_DETAIL_HTML,
  PLUSVALIA_FIXTURE_SEARCH_JSON,
  MercadolibreEcProvider,
  parseMercadolibreEcSearchJson,
  parseMercadolibreEcDetail,
  MERCADOLIBRE_EC_FIXTURE_SEARCH_JSON,
  MERCADOLIBRE_EC_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_EC_FIXTURE_DETAIL_HTML,
  ProperatiEcProvider,
  parseProperatiEcSearchJson,
  parseProperatiEcDetail,
  PROPERATI_EC_FIXTURE_SEARCH_JSON,
  PROPERATI_EC_FIXTURE_DETAIL_HTML,
  NonHousingListingError,
  parseNaventSearchJson,
  parseNaventDetail,
  type NaventSiteConfig,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const PLUSVALIA_SITE: NaventSiteConfig = {
  provider: 'plusvalia',
  baseUrl: 'https://www.plusvalia.com',
  countryCode: 'EC',
  defaultCity: 'Quito',
  defaultCurrency: 'USD',
  hrefRe: /href="((?:https:\/\/www\.plusvalia\.com)?\/propiedades\/[^"]+-(\d{5,})\.html)"/gi,
};

describe('PlusvaliaProvider', () => {
  const provider = new PlusvaliaProvider();

  it('declares EC market', () => {
    expect(provider.id).toBe('plusvalia');
    expect(provider.markets).toEqual(['EC']);
  });

  it('parses Navent search JSON into refs', () => {
    const refs = parseNaventSearchJson(PLUSVALIA_SITE, PLUSVALIA_FIXTURE_SEARCH_JSON);
    expect(refs.map((r) => r.sourceId).sort()).toEqual(['11002233', '11002234']);
  });

  it('normalizes detail with contact', () => {
    const payload = parseNaventDetail(
      PLUSVALIA_SITE,
      PLUSVALIA_FIXTURE_DETAIL_HTML,
      'https://www.plusvalia.com/propiedades/clasificado/alquilercasa-casa-en-alquiler-cumbaya-11002233.html',
    );
    const listing = provider.normalize({
      ref: { provider: 'plusvalia', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1200);
    expect(listing.address.countryCode).toBe('EC');
    expect(listing.address.city).toBe('Quito');
    expect(listing.contact?.phone).toBeTruthy();
    expect(listing.bedrooms).toBe(3);
  });
});

describe('MercadolibreEcProvider', () => {
  const provider = new MercadolibreEcProvider();

  it('declares EC market', () => {
    expect(provider.id).toBe('mercadolibre_ec');
    expect(provider.markets).toEqual(['EC']);
  });

  it('parses housing search JSON', () => {
    const refs = parseMercadolibreEcSearchJson(MERCADOLIBRE_EC_FIXTURE_SEARCH_JSON);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.sourceId).toBe('MEC-1234567890');
  });

  it('rejects non-housing classifieds', () => {
    expect(() => parseMercadolibreEcSearchJson(MERCADOLIBRE_EC_FIXTURE_NON_HOUSING_JSON)).not.toThrow();
    expect(parseMercadolibreEcSearchJson(MERCADOLIBRE_EC_FIXTURE_NON_HOUSING_JSON)).toEqual([]);
  });

  it('normalizes detail JSON-LD', () => {
    const payload = parseMercadolibreEcDetail(
      MERCADOLIBRE_EC_FIXTURE_DETAIL_HTML,
      'https://departamento.mercadolibre.com.ec/MEC-1234567890-alquiler-depto-quito-_JM',
    );
    const listing = provider.normalize({
      ref: { provider: 'mercadolibre_ec', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(450);
    expect(listing.address.countryCode).toBe('EC');
  });
});

describe('ProperatiEcProvider', () => {
  const provider = new ProperatiEcProvider();

  it('declares EC market', () => {
    expect(provider.id).toBe('properati_ec');
    expect(provider.markets).toEqual(['EC']);
  });

  it('parses search fixture and detail JSON-LD', () => {
    const refs = parseProperatiEcSearchJson(PROPERATI_EC_FIXTURE_SEARCH_JSON);
    expect(refs[0]?.sourceId).toBe('ec-prop-1001');
    const payload = parseProperatiEcDetail(
      PROPERATI_EC_FIXTURE_DETAIL_HTML,
      'https://www.properati.com.ec/detalle/departamento-alquiler-quito-ec-prop-1001',
    );
    const listing = provider.normalize({
      ref: { provider: 'properati_ec', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.longTermRent?.monthlyAmount).toBe(380);
    expect(listing.address.city).toBe('Quito');
  });
});
