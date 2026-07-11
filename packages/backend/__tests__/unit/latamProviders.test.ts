/**
 * LATAM listing providers — Colombia / Chile / Peru / Mexico.
 * Pure fixture → parse → normalize tests (no network).
 */

import {
  MercadolibreCoProvider,
  parseMercadolibreCoSearchJson,
  parseMercadolibreCoDetail,
  parseMercadolibreCoSearch,
  isMercadolibreCoHousingCategory,
  mercadolibreCoHousingSearchUrl,
  MERCADOLIBRE_CO_FIXTURE_SEARCH_JSON,
  MERCADOLIBRE_CO_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_CO_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_CO_FIXTURE_SEARCH_HTML,
  MERCADOLIBRE_CO_HOUSING_SLUGS,
  MetrocuadradoProvider,
  parseMetrocuadradoSearchJson,
  parseMetrocuadradoDetail,
  parseMetrocuadradoSearch,
  METROCUADRADO_FIXTURE_SEARCH_JSON,
  METROCUADRADO_FIXTURE_DETAIL_HTML,
  METROCUADRADO_FIXTURE_SEARCH_HTML,
  MercadolibreClProvider,
  parseMercadolibreClSearchJson,
  parseMercadolibreClDetail,
  parseMercadolibreClSearch,
  isMercadolibreClHousingCategory,
  mercadolibreClHousingSearchUrl,
  MERCADOLIBRE_CL_FIXTURE_SEARCH_JSON,
  MERCADOLIBRE_CL_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_CL_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_CL_FIXTURE_SEARCH_HTML,
  MERCADOLIBRE_CL_HOUSING_SLUGS,
  MercadolibrePeProvider,
  parseMercadolibrePeSearchJson,
  parseMercadolibrePeDetail,
  parseMercadolibrePeSearch,
  MERCADOLIBRE_PE_FIXTURE_SEARCH_JSON,
  MERCADOLIBRE_PE_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_PE_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_PE_FIXTURE_SEARCH_HTML,
  MercadolibreMxProvider,
  parseMercadolibreMxSearchJson,
  parseMercadolibreMxDetail,
  parseMercadolibreMxSearch,
  isMercadolibreMxHousingCategory,
  mercadolibreMxHousingSearchUrl,
  MERCADOLIBRE_MX_FIXTURE_SEARCH_JSON,
  MERCADOLIBRE_MX_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_MX_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_MX_FIXTURE_SEARCH_HTML,
  MERCADOLIBRE_MX_HOUSING_SLUGS,
  isHousingCategoryUrl,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

describe('MercadolibreCoProvider', () => {
  const provider = new MercadolibreCoProvider();

  it('declares CO market and housing-only discover URL', () => {
    expect(provider.id).toBe('mercadolibre_co');
    expect(provider.markets).toEqual(['CO']);
    const url = mercadolibreCoHousingSearchUrl('bogota-dc');
    expect(isHousingCategoryUrl(url, MERCADOLIBRE_CO_HOUSING_SLUGS)).toBe(true);
    expect(url).toContain('/departamentos/arriendo/');
  });

  it('parses housing search JSON and rejects cars', () => {
    const refs = parseMercadolibreCoSearchJson(MERCADOLIBRE_CO_FIXTURE_SEARCH_JSON);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.sourceId).toBe('MCO-2847653074');
    expect(parseMercadolibreCoSearchJson(MERCADOLIBRE_CO_FIXTURE_NON_HOUSING_JSON)).toEqual([]);
    expect(isMercadolibreCoHousingCategory(undefined, 'CARS_AND_VANS')).toBe(false);
  });

  it('normalizes detail HTML with contact', () => {
    const refs = parseMercadolibreCoSearch(MERCADOLIBRE_CO_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    const payload = parseMercadolibreCoDetail(
      MERCADOLIBRE_CO_FIXTURE_DETAIL_HTML,
      'https://departamento.mercadolibre.com.co/MCO-2847653074-arriendo-apartamento-2-habitaciones-chapinero-_JM',
    );
    const listing = provider.normalize({
      ref: { provider: 'mercadolibre_co', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.longTermRent?.currency).toBe('COP');
    expect(listing.address.countryCode).toBe('CO');
    expect(listing.contact?.phone).toBeTruthy();
  });
});

describe('MetrocuadradoProvider', () => {
  const provider = new MetrocuadradoProvider();

  it('declares CO market', () => {
    expect(provider.id).toBe('metrocuadrado');
    expect(provider.markets).toEqual(['CO']);
  });

  it('parses Navent search JSON into refs', () => {
    const refs = parseMetrocuadradoSearchJson(METROCUADRADO_FIXTURE_SEARCH_JSON);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['83001122', '83001123']);
  });

  it('parses __PRELOADED_STATE__ search HTML', () => {
    const refs = parseMetrocuadradoSearch(METROCUADRADO_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0]?.url).toContain('metrocuadrado.com');
  });

  it('normalizes detail with contact phone', () => {
    const payload = parseMetrocuadradoDetail(
      METROCUADRADO_FIXTURE_DETAIL_HTML,
      'https://www.metrocuadrado.com/propiedades/clasificado/arriendoapartamento-apartamento-2-hab-chapinero-83001122.html',
    );
    const listing = provider.normalize({
      ref: { provider: 'metrocuadrado', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(2800000);
    expect(listing.longTermRent?.currency).toBe('COP');
    expect(listing.address.countryCode).toBe('CO');
    expect(listing.contact?.phone).toBeTruthy();
    expect(listing.bedrooms).toBe(2);
  });
});

describe('MercadolibreClProvider', () => {
  const provider = new MercadolibreClProvider();

  it('declares CL market and arriendo discover URL', () => {
    expect(provider.id).toBe('mercadolibre_cl');
    expect(provider.markets).toEqual(['CL']);
    const url = mercadolibreClHousingSearchUrl('santiago-rm');
    expect(isHousingCategoryUrl(url, MERCADOLIBRE_CL_HOUSING_SLUGS)).toBe(true);
    expect(url).toContain('/departamentos/arriendo/');
  });

  it('parses housing search JSON and rejects cars', () => {
    const refs = parseMercadolibreClSearchJson(MERCADOLIBRE_CL_FIXTURE_SEARCH_JSON);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.sourceId).toBe('MLC-1847653074');
    expect(parseMercadolibreClSearchJson(MERCADOLIBRE_CL_FIXTURE_NON_HOUSING_JSON)).toEqual([]);
    expect(isMercadolibreClHousingCategory(undefined, 'CARS_AND_VANS')).toBe(false);
  });

  it('normalizes detail HTML with contact', () => {
    const refs = parseMercadolibreClSearch(MERCADOLIBRE_CL_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    const payload = parseMercadolibreClDetail(
      MERCADOLIBRE_CL_FIXTURE_DETAIL_HTML,
      'https://departamento.mercadolibre.cl/MLC-1847653074-arriendo-departamento-2-dormitorios-providencia-_JM',
    );
    const listing = provider.normalize({
      ref: { provider: 'mercadolibre_cl', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.longTermRent?.currency).toBe('CLP');
    expect(listing.address.countryCode).toBe('CL');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.contact?.phone).toBeTruthy();
  });
});

describe('MercadolibrePeProvider', () => {
  const provider = new MercadolibrePeProvider();

  it('declares PE market', () => {
    expect(provider.id).toBe('mercadolibre_pe');
    expect(provider.markets).toEqual(['PE']);
  });

  it('parses housing search JSON and rejects cars', () => {
    const refs = parseMercadolibrePeSearchJson(MERCADOLIBRE_PE_FIXTURE_SEARCH_JSON);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.sourceId).toBe('MPE-3847653074');
    expect(parseMercadolibrePeSearchJson(MERCADOLIBRE_PE_FIXTURE_NON_HOUSING_JSON)).toEqual([]);
  });

  it('normalizes detail HTML with contact', () => {
    const refs = parseMercadolibrePeSearch(MERCADOLIBRE_PE_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    const payload = parseMercadolibrePeDetail(
      MERCADOLIBRE_PE_FIXTURE_DETAIL_HTML,
      'https://departamento.mercadolibre.com.pe/MPE-3847653074-alquiler-departamento-2-dormitorios-miraflores-_JM',
    );
    const listing = provider.normalize({
      ref: { provider: 'mercadolibre_pe', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.longTermRent?.monthlyAmount).toBe(3200);
    expect(listing.longTermRent?.currency).toBe('PEN');
    expect(listing.address.countryCode).toBe('PE');
    expect(listing.contact?.phone).toBeTruthy();
  });
});

describe('MercadolibreMxProvider', () => {
  const provider = new MercadolibreMxProvider();

  it('declares MX market and renta discover URL', () => {
    expect(provider.id).toBe('mercadolibre_mx');
    expect(provider.markets).toEqual(['MX']);
    const url = mercadolibreMxHousingSearchUrl('ciudad-de-mexico');
    expect(isHousingCategoryUrl(url, MERCADOLIBRE_MX_HOUSING_SLUGS)).toBe(true);
    expect(url).toContain('/departamentos/renta/');
  });

  it('parses housing search JSON and rejects cars', () => {
    const refs = parseMercadolibreMxSearchJson(MERCADOLIBRE_MX_FIXTURE_SEARCH_JSON);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.sourceId).toBe('MLM-3847653074');
    expect(parseMercadolibreMxSearchJson(MERCADOLIBRE_MX_FIXTURE_NON_HOUSING_JSON)).toEqual([]);
    expect(isMercadolibreMxHousingCategory(undefined, 'CARS_AND_VANS')).toBe(false);
  });

  it('normalizes cold-HTTP detail HTML with specs, region and gallery', () => {
    const refs = parseMercadolibreMxSearch(MERCADOLIBRE_MX_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    const payload = parseMercadolibreMxDetail(
      MERCADOLIBRE_MX_FIXTURE_DETAIL_HTML,
      'https://departamento.mercadolibre.com.mx/MLM-3847653074-renta-departamento-2-recamaras-roma-_JM',
    );
    const listing = provider.normalize({
      ref: { provider: 'mercadolibre_mx', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.longTermRent?.currency).toBe('MXN');
    expect(listing.address.countryCode).toBe('MX');
    expect(listing.contact?.phone).toBeTruthy();
    // Highlighted-specs block (`BED → "2 rec."`, `BATHROOM → "2 baños"`, `SCALE_UP → "72 m² totales"`).
    expect(listing.bedrooms).toBe(2);
    expect(listing.bathrooms).toBe(2);
    expect(listing.squareFootage).toBe(72);
    // Region is the address-adjacent state, never the UI `"state":"VISIBLE"` flag.
    expect(listing.address.state).toBe('Ciudad de México');
    // Full gallery, not the single JSON-LD image.
    expect(listing.remoteImages.length).toBeGreaterThanOrEqual(2);
    expect(listing.remoteImages[0]?.url).toContain('http2.mlstatic.com');
  });
});
