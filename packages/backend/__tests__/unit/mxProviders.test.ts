/**
 * Mexico listing providers — fixture normalize / housing-filter tests (pure).
 */

import {
  Inmuebles24Provider,
  parseInmuebles24Detail,
  parseInmuebles24SearchJson,
  INMUEBLES24_FIXTURE_DETAIL_HTML,
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
  isHousingCategoryUrl,
  NonHousingListingError,
  PropiedadesProvider,
  parsePropiedadesDetail,
  parsePropiedadesSearch,
  PROPIEDADES_FIXTURE_DETAIL_HTML,
  PROPIEDADES_FIXTURE_SEARCH_HTML,
} from '@homiio/listing-providers';
import type { ExternalListingRef } from '@homiio/listing-providers';
import { OfferingType } from '@homiio/shared-types';

describe('Inmuebles24Provider (MX Navent)', () => {
  const provider = new Inmuebles24Provider();

  it('normalizes detail fixture with contact', () => {
    const url =
      'https://www.inmuebles24.com/propiedades/departamento-en-renta-en-polanco-3-recamaras-63741829.html';
    const payload = parseInmuebles24Detail(INMUEBLES24_FIXTURE_DETAIL_HTML, url);
    const ref: ExternalListingRef = {
      provider: 'inmuebles24',
      sourceId: payload.sourceId,
      url: payload.url,
    };
    const listing = provider.normalize({ ref, payload });
    expect(listing.source).toBe('inmuebles24');
    expect(listing.sourceId).toBe('63741829');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(45000);
    expect(listing.address.countryCode).toBe('MX');
    expect(listing.contact?.phone).toBeTruthy();
  });

  it('parses search JSON refs', () => {
    expect(parseInmuebles24SearchJson(INMUEBLES24_FIXTURE_SEARCH_JSON).length).toBeGreaterThanOrEqual(1);
  });
});

describe('LamudiProvider (MX JSON-LD)', () => {
  const provider = new LamudiProvider();

  it('parses search ItemList and normalizes detail with MONTH rent + contact', () => {
    const refs = parseLamudiSearch(LAMUDI_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].sourceId).toContain('fixture-rent');

    const payload = parseLamudiDetail(
      LAMUDI_FIXTURE_DETAIL_HTML,
      'https://www.lamudi.com.mx/detalle/41032-73-fixture-rent',
    );
    const listing = provider.normalize({
      ref: { provider: 'lamudi', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('lamudi');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(40000);
    expect(listing.contact?.phone).toBeTruthy();
  });
});

describe('VivanunciosProvider housing-only', () => {
  const provider = new VivanunciosProvider();

  it('accepts housing fixture and rejects car fixture', () => {
    const housing = parseVivanunciosDetail(
      VIVANUNCIOS_FIXTURE_DETAIL_HTML,
      'https://www.vivanuncios.com.mx/a-renta-departamento/ciudad-de-mexico/depto-roma-sur/1847293847',
    );
    const listing = provider.normalize({
      ref: { provider: 'vivanuncios', sourceId: housing.sourceId, url: housing.url },
      payload: housing,
    });
    expect(listing.source).toBe('vivanuncios');
    expect(listing.longTermRent?.monthlyAmount ?? listing.sale?.price).toBeTruthy();

    expect(() =>
      parseVivanunciosDetail(
        VIVANUNCIOS_FIXTURE_CAR_HTML,
        'https://www.vivanuncios.com.mx/s-autos/honda-civic/v1c29l999',
      ),
    ).toThrow(NonHousingListingError);
  });

  it('search skips non-housing hrefs and scopes discover URLs', () => {
    const refs = parseVivanunciosSearch(VIVANUNCIOS_FIXTURE_SEARCH_HTML);
    expect(refs.every((ref) => isHousingCategoryUrl(ref.url, VIVANUNCIOS_HOUSING_SLUGS))).toBe(true);
    expect(
      isHousingCategoryUrl(
        'https://www.vivanuncios.com.mx/s-departamentos-en-renta/ciudad-de-mexico',
        VIVANUNCIOS_HOUSING_SLUGS,
      ),
    ).toBe(true);
    expect(
      isHousingCategoryUrl('https://www.vivanuncios.com.mx/s-autos/honda', VIVANUNCIOS_HOUSING_SLUGS),
    ).toBe(false);
  });
});

describe('PropiedadesProvider (MX)', () => {
  const provider = new PropiedadesProvider();

  it('normalizes JSON-LD detail fixture', () => {
    const refs = parsePropiedadesSearch(PROPIEDADES_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBe(1);
    const payload = parsePropiedadesDetail(
      PROPIEDADES_FIXTURE_DETAIL_HTML,
      'https://www.propiedades.com/inmueble/12345678',
    );
    const listing = provider.normalize({
      ref: { provider: 'propiedades', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('propiedades');
    expect(listing.longTermRent?.monthlyAmount).toBe(28000);
    expect(listing.contact?.phone).toBeTruthy();
  });
});
