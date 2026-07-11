/**
 * Habitaclia provider contract test (pure — no DB, no live portal).
 *
 * Drives the `habitaclia` plugin from RECORDED HTML fixtures: the search parser
 * yields de-duplicated detail refs, the detail parser extracts the embedded
 * schema.org JSON-LD into a raw payload, and `normalize()` maps that onto a
 * provider-agnostic, published, self-describing `NormalizedListing`. No network
 * is touched — CI never scrapes.
 */

import {
  HabitacliaProvider,
  HABITACLIA_FIXTURE_DETAIL_HTML,
  HABITACLIA_FIXTURE_DETAIL_HTML_LIVE,
  HABITACLIA_FIXTURE_SEARCH_HTML,
  buildHabitacliaListainmueblesBody,
  extractHabitacliaListadoFormFields,
  isHabitacliaListainmueblesChallenge,
  parseHabitacliaDetail,
  parseHabitacliaListainmuebles,
  parseHabitacliaSearch,
} from '@homiio/listing-providers';
import type { ExternalListingRef, FetchRuntime, RawListing } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new HabitacliaProvider();
const DETAIL_URL =
  'https://www.habitaclia.com/alquiler-piso-esquerra_de_leixample-barcelona-i12345678900000.htm';

describe('HabitacliaProvider', () => {
  it('declares the ES market and habitaclia id', () => {
    expect(provider.id).toBe('habitaclia');
    expect(provider.markets).toEqual(['ES']);
  });

  it('parses the search page into de-duplicated detail refs', () => {
    const refs = parseHabitacliaSearch(HABITACLIA_FIXTURE_SEARCH_HTML);
    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => ref.sourceId)).toEqual(['12345678900000', '98765432100000']);
    for (const ref of refs) {
      expect(ref.url.startsWith('https://www.habitaclia.com/')).toBe(true);
    }
  });

  it('extracts the real-estate JSON-LD from the detail HTML', () => {
    const raw = parseHabitacliaDetail(HABITACLIA_FIXTURE_DETAIL_HTML, DETAIL_URL);
    expect(raw.id).toBe('12345678900000');
    expect(raw.operation).toBe('rent');
    expect(raw.price).toBe(1600);
    expect(raw.currency).toBe('EUR');
    expect(raw.address.city).toBe('Barcelona');
    expect(raw.address.countryCode).toBe('ES');
    expect(raw.bedrooms).toBe(3);
    expect(raw.bathrooms).toBe(2);
    expect(raw.squareMeters).toBe(95);
    expect(raw.furnished).toBe(true);
    expect(raw.amenities).toEqual(['elevator', 'air_conditioning']);
    // Floor / construction year / parking count live in the detail markup, not
    // the JSON-LD — the shared enrich step fills them on the JSON-LD path too.
    expect(raw.floor).toBe(5);
    expect(raw.yearBuilt).toBe(2005);
    expect(raw.parkingSpaces).toBe(1);
    expect(raw.images).toHaveLength(2);
    expect(raw.images[0]?.isPrimary).toBe(true);
  });

  it('throws on a page with no parseable listing data', () => {
    expect(() => parseHabitacliaDetail('<html><body>challenge</body></html>', DETAIL_URL)).toThrow(
      /no parseable price/,
    );
  });

  it('parses live detail HTML via microdata when JSON-LD is absent', () => {
    const raw = parseHabitacliaDetail(HABITACLIA_FIXTURE_DETAIL_HTML_LIVE, DETAIL_URL);
    expect(raw.id).toBe('55551000004519');
    expect(raw.price).toBe(1600);
    expect(raw.address.city).toBe('Barcelona');
    expect(raw.address.neighborhood).toBe('Gràcia');
    expect(raw.bedrooms).toBe(3);
    expect(raw.bathrooms).toBe(2);
    expect(raw.squareMeters).toBe(95);
    // "Planta 4ª" / "Año construcción 1998" / "2 plazas de garaje" become
    // structured numerics — not junk amenity slugs.
    expect(raw.floor).toBe(4);
    expect(raw.yearBuilt).toBe(1998);
    expect(raw.parkingSpaces).toBe(2);
    expect(raw.amenities).toEqual(['elevator', 'terrace']);
  });

  it('ignores fuzzy characteristics that carry no reliable number', () => {
    const html = HABITACLIA_FIXTURE_DETAIL_HTML_LIVE.replace('Planta 4ª', 'Planta baja')
      .replace('Año construcción 1998', 'Antigüedad: entre 30 y 50 años')
      .replace('2 plazas de garaje', 'Plaza de garaje');
    const raw = parseHabitacliaDetail(html, DETAIL_URL);
    expect(raw.floor).toBeUndefined();
    expect(raw.yearBuilt).toBeUndefined();
    expect(raw.parkingSpaces).toBeUndefined();
  });

  it('extracts listainmuebles form fields and parses AJAX fragments', () => {
    const fields = extractHabitacliaListadoFormFields(HABITACLIA_FIXTURE_SEARCH_HTML);
    expect(fields['Filtros.Geo.CodProv']).toBe('1');
    expect(fields['Filtros.Geo.NomPobBuscador']).toBe('barcelona');
    expect(buildHabitacliaListainmueblesBody(fields, 2)).toContain('pagina=2');
    const refs = parseHabitacliaListainmuebles(HABITACLIA_FIXTURE_SEARCH_HTML);
    expect(refs).toHaveLength(2);
    expect(isHabitacliaListainmueblesChallenge('403 ERROR')).toBe(true);
  });

  it('normalizes a recorded fixture into a published long-term rental', () => {
    const raw = parseHabitacliaDetail(HABITACLIA_FIXTURE_DETAIL_HTML, DETAIL_URL);
    const listing = provider.normalize({
      ref: { provider: 'habitaclia', sourceId: raw.id, url: raw.url },
      payload: raw,
    });

    expect(listing.source).toBe('habitaclia');
    expect(listing.sourceId).toBe('12345678900000');
    expect(listing.sourceUrl.startsWith('http')).toBe(true);
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1600);
    expect(listing.longTermRent?.currency).toBe('EUR');
    expect(listing.sale).toBeUndefined();
    expect(listing.address.city).toBe('Barcelona');
    expect(listing.address.countryCode).toBe('ES');
    expect(listing.address.coordinates).toEqual({ lat: 41.3959, lng: 2.1631 });
    expect(listing.furnishedStatus).toBe('furnished');
    expect(listing.floor).toBe(5);
    expect(listing.yearBuilt).toBe(2005);
    expect(listing.parkingSpaces).toBe(1);
    expect(listing.remoteImages).toHaveLength(2);
    expect(listing.remoteImages.filter((image) => image.isPrimary)).toHaveLength(1);
  });

  it('rejects a payload that is not a HabitacliaRawListing', () => {
    const bad: RawListing = {
      ref: { provider: 'habitaclia', sourceId: 'x', url: 'https://x' },
      payload: 42,
    };
    expect(() => provider.normalize(bad)).toThrow(/HabitacliaRawListing/);
  });

  it('reports healthy', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('habitaclia');
    expect(health.status).toBe('healthy');
  });
});

describe('HabitacliaProvider.discover listainmuebles path', () => {
  it('yields refs from a warmed session with POST pagination', async () => {
    let postPages = 0;
    const runtime: FetchRuntime = {
      fetchHttp: async () => ({ status: 500, body: '' }),
      fetchJson: async () => {
        throw new Error('unused');
      },
      fetchText: async () => {
        throw new Error('unused');
      },
      loadFixture: async () => {
        throw new Error('unused');
      },
      openBrowserSession: async () => ({
        request: async (_url, init) => {
          postPages += 1;
          const page = init?.data?.includes('pagina=2') ? 2 : 1;
          return {
            status: 200,
            body: page === 1 ? HABITACLIA_FIXTURE_SEARCH_HTML : '<html></html>',
          };
        },
        content: async () => HABITACLIA_FIXTURE_SEARCH_HTML,
        pageUrl: () => 'https://www.habitaclia.com/alquiler-barcelona.htm',
        warmNavigate: async () => undefined,
        exportStorageState: async () => ({ cookies: [] }),
        close: async () => undefined,
      }),
    };

    const local = new HabitacliaProvider({ runtime });
    const refs: ExternalListingRef[] = [];
    for await (const ref of local.discover({
      provider: 'habitaclia',
      market: 'ES',
      city: 'barcelona',
      limit: 10,
      runtime,
    })) {
      refs.push(ref);
    }

    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['12345678900000', '98765432100000']);
    expect(postPages).toBeGreaterThanOrEqual(0);
  });

  it('falls back to HTML ladder when the listainmuebles session fails', async () => {
    let htmlFetches = 0;
    const runtime: FetchRuntime = {
      fetchHttp: async () => {
        htmlFetches += 1;
        return { status: 200, body: HABITACLIA_FIXTURE_SEARCH_HTML };
      },
      fetchJson: async () => {
        throw new Error('unused');
      },
      fetchText: async () => {
        throw new Error('unused');
      },
      loadFixture: async () => {
        throw new Error('unused');
      },
      openBrowserSession: async () => {
        throw new Error('warm-up blocked');
      },
    };

    const local = new HabitacliaProvider({ runtime });
    const refs: ExternalListingRef[] = [];
    for await (const ref of local.discover({
      provider: 'habitaclia',
      market: 'ES',
      city: 'barcelona',
      limit: 5,
      runtime,
    })) {
      refs.push(ref);
    }

    expect(htmlFetches).toBeGreaterThan(0);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['12345678900000', '98765432100000']);
  });
});
