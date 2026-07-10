/**
 * Idealista provider contract test (pure — no DB, no network).
 *
 * Exercises the recorded-fixture → parse → normalize path: the provider turns
 * an Idealista detail page's embedded schema.org JSON-LD into a first-party,
 * published, sourced {@link NormalizedListing}, and its search / georeach
 * parsers yield de-duplicated `/inmueble/<id>/` refs. NO live portal is touched
 * (Idealista is behind anti-bot walls and the provider ships OFF by default).
 */

import {
  IdealistaProvider,
  isIdealistaChallenge,
  idealistaSourceIdFromUrl,
  parseIdealistaDetail,
  parseIdealistaSearch,
  parseIdealistaGeoreach,
  idealistaGeoreachUrl,
  idealistaGeoreachSlug,
  idealistaWarmSearchUrl,
  isIdealistaGeoreachChallenge,
  IDEALISTA_FIXTURE_DETAIL_HTML,
  IDEALISTA_FIXTURE_SALE_DETAIL_HTML,
  IDEALISTA_FIXTURE_SEARCH_HTML,
  IDEALISTA_FIXTURE_GEOREACH_JSON,
  IDEALISTA_FIXTURE_GEOREACH_HTML_JSON,
  IDEALISTA_FIXTURE_GEOREACH_CHALLENGE,
} from '@homiio/listing-providers';
import type { ExternalListingRef, FetchRuntime } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new IdealistaProvider();

function normalizeFromHtml(html: string, url: string) {
  const payload = parseIdealistaDetail(html, url);
  const ref: ExternalListingRef = { provider: 'idealista', sourceId: payload.sourceId, url: payload.url };
  return provider.normalize({ ref, payload });
}

describe('IdealistaProvider.normalize', () => {
  it('maps a rent detail page into a published long-term-rent listing', () => {
    const listing = normalizeFromHtml(
      IDEALISTA_FIXTURE_DETAIL_HTML,
      'https://www.idealista.com/inmueble/98765432/',
    );

    expect(listing.source).toBe('idealista');
    expect(listing.sourceId).toBe('98765432');
    expect(listing.sourceUrl).toBe('https://www.idealista.com/inmueble/98765432/');
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1450);
    expect(listing.longTermRent?.currency).toBe('EUR');
    expect(listing.sale).toBeUndefined();

    expect(listing.address.city).toBe('Barcelona');
    expect(listing.address.state).toBe('Barcelona');
    expect(listing.address.countryCode).toBe('ES');
    expect(listing.address.postalCode).toBe('08008');
    expect(listing.address.neighborhood).toContain('Eixample');
    expect(listing.address.coordinates).toEqual({ lat: 41.3947, lng: 2.1636 });

    expect(listing.bedrooms).toBe(2);
    expect(listing.bathrooms).toBe(1);
    expect(listing.squareFootage).toBe(78);
    expect(listing.furnishedStatus).toBe('furnished');
    expect(listing.amenities).toEqual(expect.arrayContaining(['elevator', 'air_conditioning', 'terrace']));
    // "Amueblado" becomes furnishedStatus, never an amenity key.
    expect(listing.amenities).not.toContain('furnished');
  });

  it('never emits a portal CDN url as a runtime image (only remoteImages)', () => {
    const listing = normalizeFromHtml(
      IDEALISTA_FIXTURE_DETAIL_HTML,
      'https://www.idealista.com/inmueble/98765432/',
    );
    expect(listing.remoteImages.length).toBe(2);
    expect(listing.remoteImages[0].isPrimary).toBe(true);
    for (const image of listing.remoteImages) {
      expect(image.url.startsWith('https://')).toBe(true);
    }
    // The DTO carries no runtime images[] field — re-hosting happens at ingest.
    expect('images' in listing).toBe(false);
  });

  it('maps a sale detail page into a SALE offering', () => {
    const listing = normalizeFromHtml(
      IDEALISTA_FIXTURE_SALE_DETAIL_HTML,
      'https://www.idealista.com/inmueble/11223344/',
    );
    expect(listing.sourceId).toBe('11223344');
    expect(listing.type).toBe(PropertyType.HOUSE);
    expect(listing.offerings).toEqual([OfferingType.SALE]);
    expect(listing.sale?.price).toBe(685000);
    expect(listing.sale?.currency).toBe('EUR');
    expect(listing.longTermRent).toBeUndefined();
  });

  it('throws on a page with no real-estate JSON-LD', () => {
    expect(() => parseIdealistaDetail('<html><body>no data</body></html>', 'https://x/inmueble/1/')).toThrow(
      /no real-estate JSON-LD/,
    );
  });
});

describe('IdealistaProvider search + helpers', () => {
  it('parses de-duplicated detail refs from a search page', () => {
    const refs = parseIdealistaSearch(IDEALISTA_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['98765432', '98765433', '98765434']);
    for (const ref of refs) {
      expect(ref.url).toBe(`https://www.idealista.com/inmueble/${ref.sourceId}/`);
    }
  });

  it('extracts a source id from a detail url', () => {
    expect(idealistaSourceIdFromUrl('https://www.idealista.com/inmueble/98765432/')).toBe('98765432');
    expect(idealistaSourceIdFromUrl('https://www.idealista.com/en/nope/')).toBeUndefined();
  });

  it('flags an anti-bot / tiny body as a challenge', () => {
    expect(isIdealistaChallenge('<html>Acceso denegado</html>')).toBe(true);
    expect(isIdealistaChallenge('tiny')).toBe(true);
    expect(isIdealistaChallenge(IDEALISTA_FIXTURE_DETAIL_HTML)).toBe(false);
  });

  it('reports healthy before any fetch attempt', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('idealista');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
  });
});

describe('Idealista georeach AJAX parser', () => {
  it('builds city-province georeach and warm URLs', () => {
    expect(idealistaGeoreachSlug('Madrid')).toBe('madrid-madrid');
    expect(idealistaGeoreachSlug('Barcelona')).toBe('barcelona-barcelona');
    expect(idealistaGeoreachUrl('madrid')).toBe(
      'https://www.idealista.com/es/ajax/listing/georeach/madrid-madrid',
    );
    expect(idealistaGeoreachUrl('madrid', 2)).toContain('page=2');
    expect(idealistaWarmSearchUrl('valencia')).toBe(
      'https://www.idealista.com/alquiler-viviendas/valencia/',
    );
  });

  it('parses adId / propertyCode items from georeach JSON', () => {
    const refs = parseIdealistaGeoreach(IDEALISTA_FIXTURE_GEOREACH_JSON);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['98765432', '98765433', '98765434']);
    for (const ref of refs) {
      expect(ref.url).toBe(`https://www.idealista.com/inmueble/${ref.sourceId}/`);
    }
  });

  it('parses listing ids from an embedded HTML georeach payload', () => {
    const refs = parseIdealistaGeoreach(IDEALISTA_FIXTURE_GEOREACH_HTML_JSON);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['55556666', '55557777']);
  });

  it('treats DataDome captcha JSON as a challenge and yields no refs', () => {
    expect(isIdealistaGeoreachChallenge(IDEALISTA_FIXTURE_GEOREACH_CHALLENGE)).toBe(true);
    expect(parseIdealistaGeoreach(IDEALISTA_FIXTURE_GEOREACH_CHALLENGE)).toEqual([]);
  });
});

describe('IdealistaProvider.discover georeach path', () => {
  it('yields refs from a warmed session georeach AJAX response', async () => {
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
        request: async () => ({ status: 200, body: IDEALISTA_FIXTURE_GEOREACH_JSON }),
        content: async () => IDEALISTA_FIXTURE_SEARCH_HTML,
        pageUrl: () => 'https://www.idealista.com/alquiler-viviendas/madrid/',
        exportStorageState: async () => ({ cookies: [] }),
        close: async () => undefined,
      }),
    };

    const local = new IdealistaProvider({ runtime, cities: ['madrid'] });
    const refs: ExternalListingRef[] = [];
    for await (const ref of local.discover({
      provider: 'idealista',
      market: 'ES',
      city: 'madrid',
      limit: 10,
      runtime,
    })) {
      refs.push(ref);
    }

    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['98765432', '98765433', '98765434']);
    expect(refs.every((ref) => ref.provider === 'idealista')).toBe(true);
  });

  it('falls back to HTML ladder when georeach returns a challenge', async () => {
    let htmlFetches = 0;
    const runtime: FetchRuntime = {
      fetchHttp: async () => {
        htmlFetches += 1;
        return { status: 200, body: IDEALISTA_FIXTURE_SEARCH_HTML };
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
        request: async () => ({ status: 403, body: IDEALISTA_FIXTURE_GEOREACH_CHALLENGE }),
        content: async () => '<html>datadome</html>',
        pageUrl: () => 'https://www.idealista.com/alquiler-viviendas/madrid/',
        exportStorageState: async () => ({ cookies: [] }),
        close: async () => undefined,
      }),
    };

    const local = new IdealistaProvider({ runtime, cities: ['madrid'] });
    const refs: ExternalListingRef[] = [];
    for await (const ref of local.discover({
      provider: 'idealista',
      market: 'ES',
      city: 'madrid',
      limit: 5,
      runtime,
    })) {
      refs.push(ref);
    }

    expect(htmlFetches).toBeGreaterThan(0);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['98765432', '98765433', '98765434']);
  });
});
