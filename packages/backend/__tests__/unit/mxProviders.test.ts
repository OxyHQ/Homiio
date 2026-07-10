/**
 * Mexico listing providers — Inmuebles24 / Lamudi / Vivanuncios / Propiedades.
 * Pure fixture → parse → normalize tests (no network).
 */

import {
  Inmuebles24Provider,
  parseInmuebles24Detail,
  parseInmuebles24Search,
  parseInmuebles24SearchJson,
  INMUEBLES24_FIXTURE_DETAIL_HTML,
  INMUEBLES24_FIXTURE_SEARCH_HTML,
  INMUEBLES24_FIXTURE_SEARCH_JSON,
  LamudiProvider,
  parseLamudiDetail,
  parseLamudiSearch,
  LAMUDI_FIXTURE_DETAIL_HTML,
  LAMUDI_FIXTURE_SEARCH_HTML,
  VivanunciosProvider,
  parseVivanunciosDetail,
  parseVivanunciosSearch,
  VIVANUNCIOS_FIXTURE_DETAIL_HTML,
  VIVANUNCIOS_FIXTURE_CAR_HTML,
  VIVANUNCIOS_FIXTURE_SEARCH_HTML,
  VIVANUNCIOS_HOUSING_SLUGS,
  PropiedadesProvider,
  parsePropiedadesDetail,
  parsePropiedadesSearch,
  PROPIEDADES_FIXTURE_DETAIL_HTML,
  PROPIEDADES_FIXTURE_SEARCH_HTML,
  isHousingCategoryUrl,
  NonHousingListingError,
} from '@homiio/listing-providers';
import { OfferingType } from '@homiio/shared-types';

describe('Inmuebles24Provider', () => {
  const provider = new Inmuebles24Provider();

  it('declares MX market', () => {
    expect(provider.id).toBe('inmuebles24');
    expect(provider.markets).toEqual(['MX']);
  });

  it('parses Navent search JSON into refs', () => {
    const refs = parseInmuebles24SearchJson(INMUEBLES24_FIXTURE_SEARCH_JSON);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['63741829', '63741830']);
  });

  it('parses __PRELOADED_STATE__ search HTML', () => {
    const refs = parseInmuebles24Search(INMUEBLES24_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0]?.url).toContain('inmuebles24.com');
  });

  it('normalizes rent detail with contact', () => {
    const payload = parseInmuebles24Detail(
      INMUEBLES24_FIXTURE_DETAIL_HTML,
      'https://www.inmuebles24.com/propiedades/departamento-en-renta-en-polanco-3-recamaras-63741829.html',
    );
    const listing = provider.normalize({
      ref: { provider: 'inmuebles24', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(45000);
    expect(listing.longTermRent?.currency).toBe('MXN');
    expect(listing.address.countryCode).toBe('MX');
    expect(listing.contact?.phone).toBeTruthy();
    expect(listing.remoteImages.length).toBeGreaterThanOrEqual(1);
  });
});

describe('LamudiProvider', () => {
  const provider = new LamudiProvider();

  it('declares MX market', () => {
    expect(provider.id).toBe('lamudi');
    expect(provider.markets).toEqual(['MX']);
  });

  it('parses ItemList search JSON-LD', () => {
    const refs = parseLamudiSearch(LAMUDI_FIXTURE_SEARCH_HTML);
    expect(refs.some((ref) => ref.sourceId === '41032-73-fixture-rent')).toBe(true);
  });

  it('normalizes MONTH rent with phone + WhatsApp', () => {
    const payload = parseLamudiDetail(
      LAMUDI_FIXTURE_DETAIL_HTML,
      'https://www.lamudi.com.mx/detalle/41032-73-fixture-rent',
    );
    expect(payload.operation).toBe('rent');
    const listing = provider.normalize({
      ref: { provider: 'lamudi', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(40000);
    expect(listing.longTermRent?.currency).toBe('MXN');
    expect(listing.contact?.phone).toBeTruthy();
    expect(listing.contact?.whatsapp).toBeTruthy();
  });
});

describe('VivanunciosProvider', () => {
  const provider = new VivanunciosProvider();

  it('declares MX market and housing-only URL allowlist', () => {
    expect(provider.id).toBe('vivanuncios');
    expect(provider.markets).toEqual(['MX']);
    expect(
      isHousingCategoryUrl(
        'https://www.vivanuncios.com.mx/s-departamentos-en-renta/ciudad-de-mexico',
        VIVANUNCIOS_HOUSING_SLUGS,
      ),
    ).toBe(true);
    expect(
      isHousingCategoryUrl(
        'https://www.vivanuncios.com.mx/s-autos/ciudad-de-mexico',
        VIVANUNCIOS_HOUSING_SLUGS,
      ),
    ).toBe(false);
  });

  it('parses housing search and ignores car hrefs', () => {
    const refs = parseVivanunciosSearch(VIVANUNCIOS_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['1847293847', '1847293848']);
  });

  it('normalizes housing detail and rejects cars', () => {
    const housing = parseVivanunciosDetail(
      VIVANUNCIOS_FIXTURE_DETAIL_HTML,
      'https://www.vivanuncios.com.mx/a-renta-departamento/ciudad-de-mexico/depto-roma-sur/1847293847',
    );
    const listing = provider.normalize({
      ref: { provider: 'vivanuncios', sourceId: housing.sourceId, url: housing.url },
      payload: housing,
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(22000);
    expect(listing.contact?.phone).toBeTruthy();

    expect(() =>
      parseVivanunciosDetail(
        VIVANUNCIOS_FIXTURE_CAR_HTML,
        'https://www.vivanuncios.com.mx/a-autos/ciudad-de-mexico/vw-jetta/999000111',
      ),
    ).toThrow(NonHousingListingError);
  });
});

describe('PropiedadesProvider', () => {
  const provider = new PropiedadesProvider();

  it('declares MX market', () => {
    expect(provider.id).toBe('propiedades');
    expect(provider.markets).toEqual(['MX']);
  });

  it('parses search and normalizes detail with contact', () => {
    const refs = parsePropiedadesSearch(PROPIEDADES_FIXTURE_SEARCH_HTML);
    expect(refs.some((ref) => ref.sourceId === '12345678')).toBe(true);
    const payload = parsePropiedadesDetail(
      PROPIEDADES_FIXTURE_DETAIL_HTML,
      'https://www.propiedades.com/inmueble/12345678',
    );
    const listing = provider.normalize({
      ref: { provider: 'propiedades', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.longTermRent?.monthlyAmount).toBe(28000);
    expect(listing.address.countryCode).toBe('MX');
    expect(listing.contact?.phone).toBeTruthy();
  });
});
