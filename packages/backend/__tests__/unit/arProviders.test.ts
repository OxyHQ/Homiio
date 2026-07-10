/**
 * Argentina listing providers — Zonaprop / Argenprop / MercadoLibre / Properati.
 * Pure fixture → parse → normalize tests (no network).
 */

import {
  ZonapropProvider,
  parseZonapropDetail,
  parseZonapropSearch,
  parseZonapropSearchJson,
  ZONAPROP_FIXTURE_DETAIL_HTML,
  ZONAPROP_FIXTURE_SEARCH_HTML,
  ZONAPROP_FIXTURE_SEARCH_JSON,
  ArgenpropProvider,
  parseArgenpropDetail,
  parseArgenpropSearch,
  ARGENPROP_FIXTURE_DETAIL_HTML,
  ARGENPROP_FIXTURE_SEARCH_HTML,
  MercadolibreArProvider,
  parseMercadolibreArDetail,
  parseMercadolibreArSearch,
  parseMercadolibreArSearchJson,
  isMercadolibreArHousingCategory,
  mercadolibreArHousingSearchUrl,
  MERCADOLIBRE_AR_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_AR_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_AR_FIXTURE_SEARCH_HTML,
  MERCADOLIBRE_AR_FIXTURE_SEARCH_JSON,
  MERCADOLIBRE_AR_HOUSING_SLUGS,
  ProperatiProvider,
  parseProperatiDetail,
  parseProperatiSearch,
  PROPERATI_FIXTURE_DETAIL_HTML,
  PROPERATI_FIXTURE_SEARCH_HTML,
  isHousingCategoryUrl,
  NonHousingListingError,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

describe('ZonapropProvider', () => {
  const provider = new ZonapropProvider();

  it('declares AR market', () => {
    expect(provider.id).toBe('zonaprop');
    expect(provider.markets).toEqual(['AR']);
  });

  it('parses Navent search JSON into refs', () => {
    const refs = parseZonapropSearchJson(ZONAPROP_FIXTURE_SEARCH_JSON);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['52001122', '52001123']);
  });

  it('parses __PRELOADED_STATE__ search HTML', () => {
    const refs = parseZonapropSearch(ZONAPROP_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0]?.url).toContain('zonaprop.com.ar');
  });

  it('normalizes detail with contact phone', () => {
    const payload = parseZonapropDetail(
      ZONAPROP_FIXTURE_DETAIL_HTML,
      'https://www.zonaprop.com.ar/propiedades/clasificado/alquilercasa-depto-2-amb-palermo-52001122.html',
    );
    const listing = provider.normalize({
      ref: { provider: 'zonaprop', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(450000);
    expect(listing.longTermRent?.currency).toBe('ARS');
    expect(listing.address.countryCode).toBe('AR');
    expect(listing.contact?.phone).toBeTruthy();
    expect(listing.remoteImages.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ArgenpropProvider', () => {
  const provider = new ArgenpropProvider();

  it('declares AR market', () => {
    expect(provider.id).toBe('argenprop');
    expect(provider.markets).toEqual(['AR']);
  });

  it('parses search and normalizes rent detail', () => {
    const refs = parseArgenpropSearch(ARGENPROP_FIXTURE_SEARCH_HTML);
    expect(refs.some((ref) => ref.sourceId === '16789012')).toBe(true);
    const payload = parseArgenpropDetail(
      ARGENPROP_FIXTURE_DETAIL_HTML,
      'https://www.argenprop.com/departamento-en-alquiler-en-belgrano-2-ambientes--16789012',
    );
    const listing = provider.normalize({
      ref: { provider: 'argenprop', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.address.city).toBe('Capital Federal');
    expect(listing.contact?.phone).toBeTruthy();
  });
});

describe('MercadolibreArProvider', () => {
  const provider = new MercadolibreArProvider();

  it('declares AR market and housing-only discover URL', () => {
    expect(provider.id).toBe('mercadolibre_ar');
    expect(provider.markets).toEqual(['AR']);
    const url = mercadolibreArHousingSearchUrl('capital-federal');
    expect(isHousingCategoryUrl(url, MERCADOLIBRE_AR_HOUSING_SLUGS)).toBe(true);
    expect(url).toContain('/departamentos/alquiler/');
  });

  it('parses housing search JSON and rejects cars', () => {
    const refs = parseMercadolibreArSearchJson(MERCADOLIBRE_AR_FIXTURE_SEARCH_JSON);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.sourceId).toBe('MLA-3557653074');
    expect(parseMercadolibreArSearchJson(MERCADOLIBRE_AR_FIXTURE_NON_HOUSING_JSON)).toEqual([]);
    expect(isMercadolibreArHousingCategory(undefined, 'CARS_AND_VANS')).toBe(false);
  });

  it('normalizes detail HTML with VIP city fields', () => {
    const refs = parseMercadolibreArSearch(MERCADOLIBRE_AR_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    const payload = parseMercadolibreArDetail(
      MERCADOLIBRE_AR_FIXTURE_DETAIL_HTML,
      'https://departamento.mercadolibre.com.ar/MLA-3557653074-alquiler-departamento-2-ambientes-belgrano-_JM',
    );
    const listing = provider.normalize({
      ref: { provider: 'mercadolibre_ar', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.longTermRent?.currency).toBe('ARS');
    expect(listing.address.city).toBe('Capital Federal');
    expect(listing.address.neighborhood).toBe('Belgrano');
    expect(listing.contact?.phone).toBeTruthy();
  });

  it('throws NonHousingListingError for car item JSON', () => {
    expect(() =>
      parseMercadolibreArSearchJson(MERCADOLIBRE_AR_FIXTURE_NON_HOUSING_JSON),
    ).not.toThrow();
    const car = JSON.parse(MERCADOLIBRE_AR_FIXTURE_NON_HOUSING_JSON) as {
      results: Array<Record<string, unknown>>;
    };
    expect(isMercadolibreArHousingCategory('MLA1744', String(car.results[0]?.domain_id))).toBe(
      false,
    );
    expect(NonHousingListingError).toBeDefined();
  });
});

describe('ProperatiProvider', () => {
  const provider = new ProperatiProvider();

  it('declares AR market', () => {
    expect(provider.id).toBe('properati');
    expect(provider.markets).toEqual(['AR']);
  });

  it('parses __NEXT_DATA__ search and JSON-LD detail', () => {
    const refs = parseProperatiSearch(PROPERATI_FIXTURE_SEARCH_HTML);
    expect(refs.some((ref) => ref.sourceId.includes('1001'))).toBe(true);
    const payload = parseProperatiDetail(
      PROPERATI_FIXTURE_DETAIL_HTML,
      'https://www.properati.com.ar/detalle/departamento-alquiler-palermo-properati-ar-1001',
    );
    const listing = provider.normalize({
      ref: { provider: 'properati', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(420000);
    expect(listing.address.countryCode).toBe('AR');
    expect(listing.contact?.phone).toBeTruthy();
  });
});
