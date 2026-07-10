/**
 * Fotocasa provider contract test (pure — no DB, no network).
 *
 * Exercises searchads AJAX parsing, SSR fallback, property JSON API, and the
 * fixture → parse → normalize path. NO live portal is touched.
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
    expect(listing.sourceUrl).toContain('/187654321/d');
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1850);
    expect(listing.longTermRent?.currency).toBe('EUR');

    expect(listing.address.city).toBe('Madrid');
    expect(listing.address.state).toBe('Madrid');
    expect(listing.address.neighborhood).toBe('Chamberí');
    expect(listing.address.postalCode).toBe('28010');
    expect(listing.address.coordinates).toEqual({ lat: 40.4318, lng: -3.6931 });

    expect(listing.bedrooms).toBe(3);
    expect(listing.bathrooms).toBe(2);
    expect(listing.squareFootage).toBe(95);
    expect(listing.amenities).toEqual(expect.arrayContaining(['elevator', 'heating', 'air_conditioning']));
    expect(listing.remoteImages).toHaveLength(3);
    expect(listing.remoteImages[0].isPrimary).toBe(true);
  });

  it('parses RealEstateListing JSON-LD with a nested about node', () => {
    const payload = parseFotocasaDetail(
      FOTOCASA_FIXTURE_REAL_ESTATE_LISTING_HTML,
      'https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/x/187654321/d',
    );
    expect(payload.sourceId).toBe('187654321');
    expect(payload.listing.price).toBe(1850);
    expect(payload.listing.address.city).toBe('Madrid');
  });

  it('parses listing data from __NEXT_DATA__ when JSON-LD is absent', () => {
    const payload = parseFotocasaDetail(
      FOTOCASA_FIXTURE_NEXT_DATA_HTML,
      'https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/x/187654321/d',
    );
    expect(payload.sourceId).toBe('187654321');
    expect(payload.listing.price).toBe(1850);
    expect(payload.listing.address.city).toBe('Madrid');
  });

  it('maps property JSON API payload into a normalized listing', () => {
    const payload = parseFotocasaPropertyJson(
      FOTOCASA_FIXTURE_PROPERTY_JSON,
      'https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/x/187654321/d',
    );
    expect(payload?.sourceId).toBe('187654321');
    const ref: ExternalListingRef = {
      provider: 'fotocasa',
      sourceId: payload!.sourceId,
      url: payload!.url,
    };
    const listing = provider.normalize({ ref, payload: payload! });
    expect(listing.longTermRent?.monthlyAmount).toBe(1850);
    expect(listing.address.city).toBe('Madrid');
    expect(listing.bedrooms).toBe(3);
  });

  it('throws on a page with no real-estate JSON-LD', () => {
    expect(() => parseFotocasaDetail('<html><body>nope</body></html>', 'https://x/1/d')).toThrow(
      /no real-estate JSON-LD/,
    );
  });
});

describe('Fotocasa searchads AJAX parser', () => {
  it('builds warm, location, searchads, and property API URLs', () => {
    expect(fotocasaWarmSearchUrl('madrid')).toBe(
      'https://www.fotocasa.es/es/alquiler/viviendas/madrid-capital/todas-las-zonas/l',
    );
    expect(fotocasaUrlLocationSegmentsUrl('barcelona')).toContain('location=barcelona-capital');
    const segments = parseFotocasaLocationSegments(FOTOCASA_FIXTURE_LOCATION_SEGMENTS_JSON)!;
    expect(segments.ids).toContain('28079');
    expect(fotocasaSearchadsUrl(segments, 2)).toContain('pageNumber=2');
    expect(fotocasaPropertyApiUrl('187654321')).toContain('propertyId=187654321');
  });

  it('parses propertyId / detailUrl items from searchads JSON', () => {
    const refs = parseFotocasaSearchads(FOTOCASA_FIXTURE_SEARCHADS_JSON);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['187654321', '187654322', '187654323']);
    for (const ref of refs) {
      expect(ref.url.startsWith('https://www.fotocasa.es/')).toBe(true);
      expect(ref.url.endsWith('/d')).toBe(true);
    }
  });

  it('parses SSR-embedded realEstates from warmed search HTML', () => {
    const refs = parseFotocasaSsrSearch(FOTOCASA_FIXTURE_SSR_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['187654321', '187654324']);
  });

  it('treats PerimeterX challenge HTML as blocked and yields no refs', () => {
    expect(isFotocasaSearchadsChallenge(FOTOCASA_FIXTURE_SEARCHADS_CHALLENGE)).toBe(true);
    expect(parseFotocasaSearchads(FOTOCASA_FIXTURE_SEARCHADS_CHALLENGE)).toEqual([]);
  });
});

describe('FotocasaProvider search + helpers', () => {
  it('parses de-duplicated detail refs from a search page', () => {
    const refs = parseFotocasaSearch(FOTOCASA_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['187654321', '187654322', '187654323']);
    for (const ref of refs) {
      expect(ref.url.startsWith('https://www.fotocasa.es/')).toBe(true);
      expect(ref.url.endsWith('/d')).toBe(true);
    }
  });

  it('extracts a source id from a detail url', () => {
    expect(fotocasaSourceIdFromUrl('https://www.fotocasa.es/es/alquiler/vivienda/x/187654321/d')).toBe(
      '187654321',
    );
  });

  it('flags an anti-bot / tiny body as a challenge', () => {
    expect(isFotocasaChallenge('<html>Verifica que eres una persona</html>')).toBe(true);
    expect(isFotocasaChallenge('tiny')).toBe(true);
    expect(isFotocasaChallenge(FOTOCASA_FIXTURE_DETAIL_HTML)).toBe(false);
  });

  it('reports a health verdict', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('fotocasa');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
    expect(health.detail).toContain('searchads AJAX');
  });
});

describe('FotocasaProvider.discover searchads path', () => {
  it('yields refs from a warmed session searchads AJAX response', async () => {
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
    expect(refs.every((ref) => ref.provider === 'fotocasa')).toBe(true);
  });

  it('falls back to HTML ladder when searchads returns a challenge', async () => {
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
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['187654321', '187654322', '187654323']);
  });
});
