/**
 * Fotocasa provider contract test (pure — no DB, no network).
 */

import {
  FotocasaProvider,
  isFotocasaChallenge,
  fotocasaSourceIdFromUrl,
  parseFotocasaDetail,
  parseFotocasaSearch,
  parseFotocasaPropertyJson,
  parseFotocasaSearchads,
  parseFotocasaSsrSearch,
  parseFotocasaLocationSegments,
  fotocasaWarmSearchUrl,
  fotocasaSearchadsUrl,
  fotocasaUrlLocationSegmentsUrl,
  fotocasaPropertyApiUrl,
  isFotocasaSearchadsChallenge,
  FOTOCASA_FIXTURE_DETAIL_HTML,
  FOTOCASA_FIXTURE_SEARCH_HTML,
  FOTOCASA_FIXTURE_REAL_ESTATE_LISTING_HTML,
  FOTOCASA_FIXTURE_NEXT_DATA_HTML,
  FOTOCASA_FIXTURE_SEARCHADS_JSON,
  FOTOCASA_FIXTURE_LOCATION_SEGMENTS_JSON,
  FOTOCASA_FIXTURE_SEARCHADS_CHALLENGE,
  FOTOCASA_FIXTURE_PROPERTY_JSON,
  FOTOCASA_FIXTURE_SSR_SEARCH_HTML,
} from '@homiio/listing-providers';
import type { ExternalListingRef, FetchRuntime } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new FotocasaProvider();

describe('FotocasaProvider.normalize', () => {
  it('maps a rent detail page into a published long-term-rent listing', () => {
    const payload = parseFotocasaDetail(
      FOTOCASA_FIXTURE_DETAIL_HTML,
      'https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/x/187654321/d',
    );
    const ref: ExternalListingRef = { provider: 'fotocasa', sourceId: payload.sourceId, url: payload.url };
    const listing = provider.normalize({ ref, payload });

    expect(listing.source).toBe('fotocasa');
    expect(listing.sourceId).toBe('187654321');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1850);
    expect(listing.address.city).toBe('Madrid');
    expect(listing.bedrooms).toBe(3);
  });

  it('maps property JSON API payload into a normalized listing', () => {
    const payload = parseFotocasaPropertyJson(
      FOTOCASA_FIXTURE_PROPERTY_JSON,
      'https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/x/187654321/d',
    );
    expect(payload?.sourceId).toBe('187654321');
    const listing = provider.normalize({
      ref: { provider: 'fotocasa', sourceId: payload!.sourceId, url: payload!.url },
      payload: payload!,
    });
    expect(listing.longTermRent?.monthlyAmount).toBe(1850);
    expect(listing.address.city).toBe('Madrid');
  });
});

describe('Fotocasa searchads AJAX parser', () => {
  it('builds warm, location, searchads, and property API URLs', () => {
    expect(fotocasaWarmSearchUrl('madrid')).toContain('madrid-capital');
    expect(fotocasaUrlLocationSegmentsUrl('barcelona')).toContain('barcelona-capital');
    const segments = parseFotocasaLocationSegments(FOTOCASA_FIXTURE_LOCATION_SEGMENTS_JSON)!;
    expect(fotocasaSearchadsUrl(segments, 2)).toContain('pageNumber=2');
    expect(fotocasaPropertyApiUrl('187654321')).toContain('propertyId=187654321');
  });

  it('parses propertyId / detailUrl from searchads JSON', () => {
    const refs = parseFotocasaSearchads(FOTOCASA_FIXTURE_SEARCHADS_JSON);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['187654321', '187654322', '187654323']);
  });

  it('parses SSR-embedded realEstates', () => {
    const refs = parseFotocasaSsrSearch(FOTOCASA_FIXTURE_SSR_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['187654321', '187654324']);
  });

  it('treats PerimeterX challenge as blocked', () => {
    expect(isFotocasaSearchadsChallenge(FOTOCASA_FIXTURE_SEARCHADS_CHALLENGE)).toBe(true);
    expect(parseFotocasaSearchads(FOTOCASA_FIXTURE_SEARCHADS_CHALLENGE)).toEqual([]);
  });
});

describe('FotocasaProvider.discover searchads path', () => {
  it('yields refs from warmed session searchads', async () => {
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
        request: async (url: string) => {
          if (url.includes('urllocationsegments')) {
            return { status: 200, body: FOTOCASA_FIXTURE_LOCATION_SEGMENTS_JSON };
          }
          return { status: 200, body: FOTOCASA_FIXTURE_SEARCHADS_JSON };
        },
        content: async () => FOTOCASA_FIXTURE_SSR_SEARCH_HTML,
        pageUrl: () => 'https://www.fotocasa.es/es/alquiler/viviendas/madrid-capital/todas-las-zonas/l',
        exportStorageState: async () => ({ cookies: [] }),
        close: async () => undefined,
      }),
    };

    const local = new FotocasaProvider({ runtime, cities: ['madrid'] });
    const refs: ExternalListingRef[] = [];
    for await (const ref of local.discover({
      provider: 'fotocasa',
      market: 'ES',
      city: 'madrid',
      limit: 10,
      runtime,
    })) {
      refs.push(ref);
    }

    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['187654321', '187654322', '187654323']);
  });

  it('falls back to HTML ladder when searchads is challenged', async () => {
    let htmlFetches = 0;
    const runtime: FetchRuntime = {
      fetchHttp: async () => {
        htmlFetches += 1;
        return { status: 200, body: FOTOCASA_FIXTURE_SEARCH_HTML };
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
      openBrowserSession: async () => ({
        request: async () => ({ status: 403, body: FOTOCASA_FIXTURE_SEARCHADS_CHALLENGE }),
        content: async () => FOTOCASA_FIXTURE_SEARCHADS_CHALLENGE,
        pageUrl: () => 'https://www.fotocasa.es/es/alquiler/viviendas/madrid-capital/todas-las-zonas/l',
        exportStorageState: async () => ({ cookies: [] }),
        close: async () => undefined,
      }),
    };

    const local = new FotocasaProvider({ runtime, cities: ['madrid'] });
    const refs: ExternalListingRef[] = [];
    for await (const ref of local.discover({
      provider: 'fotocasa',
      market: 'ES',
      city: 'madrid',
      limit: 5,
      runtime,
    })) {
      refs.push(ref);
    }

    expect(htmlFetches).toBeGreaterThan(0);
    expect(refs.length).toBeGreaterThan(0);
  });
});

describe('FotocasaProvider helpers', () => {
  it('parses HTML search links', () => {
    const refs = parseFotocasaSearch(FOTOCASA_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['187654321', '187654322', '187654323']);
  });

  it('flags challenge pages', () => {
    expect(isFotocasaChallenge('tiny')).toBe(true);
    expect(isFotocasaChallenge(FOTOCASA_FIXTURE_DETAIL_HTML)).toBe(false);
  });

  it('extracts source id from detail url', () => {
    expect(fotocasaSourceIdFromUrl('https://www.fotocasa.es/es/alquiler/vivienda/x/187654321/d')).toBe(
      '187654321',
    );
  });
});
