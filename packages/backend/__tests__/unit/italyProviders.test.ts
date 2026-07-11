/**
 * Italy listing providers — fixture → parse → normalize (no network).
 */

import {
  IdealistaItProvider,
  isIdealistaItChallenge,
  idealistaItSourceIdFromUrl,
  parseIdealistaItDetail,
  parseIdealistaItSearch,
  parseIdealistaItGeoreach,
  isIdealistaItGeoreachChallenge,
  IDEALISTA_IT_FIXTURE_DETAIL_HTML,
  IDEALISTA_IT_FIXTURE_SEARCH_HTML,
  IDEALISTA_IT_FIXTURE_GEOREACH_JSON,
  IDEALISTA_IT_FIXTURE_GEOREACH_CHALLENGE,
  IDEALISTA_IT_FIXTURE_CONTACT_JSON,
  ImmobiliareProvider,
  parseImmobiliareDetail,
  parseImmobiliareSearch,
  parseImmobiliareSearchJson,
  IMMOBILIARE_FIXTURE_DETAIL_HTML,
  IMMOBILIARE_FIXTURE_SEARCH_HTML,
  IMMOBILIARE_FIXTURE_SEARCH_JSON,
  CasaItProvider,
  parseCasaItDetail,
  parseCasaItSearch,
  parseCasaItSearchJson,
  CASA_IT_FIXTURE_DETAIL_HTML,
  CASA_IT_FIXTURE_SEARCH_HTML,
  CASA_IT_FIXTURE_SEARCH_JSON,
  SubitoProvider,
  coerceSubitoRaw,
  parseSubitoDetail,
  parseSubitoSearch,
  parseSubitoSearchJson,
  parseSubitoSearchListings,
  isSubitoHousingCategory,
  SUBITO_FIXTURE_DETAIL_HTML,
  SUBITO_FIXTURE_NON_HOUSING_HTML,
  SUBITO_FIXTURE_SEARCH_HTML,
  SUBITO_FIXTURE_SEARCH_JSON,
  parseIdealistaItContactInfo,
} from '@homiio/listing-providers';
import type { ExternalListingRef, FetchRuntime } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

describe('IdealistaItProvider', () => {
  const provider = new IdealistaItProvider();

  it('normalizes a rent detail page with IT address', () => {
    const payload = parseIdealistaItDetail(
      IDEALISTA_IT_FIXTURE_DETAIL_HTML,
      'https://www.idealista.it/immobile/87654321/',
    );
    const listing = provider.normalize({
      ref: { provider: 'idealista_it', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('idealista_it');
    expect(listing.sourceId).toBe('87654321');
    expect(listing.address.countryCode).toBe('IT');
    expect(listing.address.city).toBe('Roma');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1600);
    expect(listing.furnishedStatus).toBe('furnished');
  });

  it('parses georeach JSON and search HTML', () => {
    expect(parseIdealistaItGeoreach(IDEALISTA_IT_FIXTURE_GEOREACH_JSON).map((r) => r.sourceId).sort()).toEqual([
      '87654321',
      '87654322',
      '87654323',
    ]);
    expect(isIdealistaItGeoreachChallenge(IDEALISTA_IT_FIXTURE_GEOREACH_CHALLENGE)).toBe(true);
    expect(parseIdealistaItSearch(IDEALISTA_IT_FIXTURE_SEARCH_HTML).map((r) => r.sourceId).sort()).toEqual([
      '87654321',
      '87654322',
      '87654323',
    ]);
    expect(idealistaItSourceIdFromUrl('https://www.idealista.it/immobile/87654321/')).toBe('87654321');
    expect(isIdealistaItChallenge('tiny')).toBe(true);
  });

  it('parses contact AJAX JSON', () => {
    const contact = parseIdealistaItContactInfo(IDEALISTA_IT_FIXTURE_CONTACT_JSON);
    expect(contact?.phone).toContain('0612345678');
    expect(contact?.email).toContain('agenziaromacentro');
    expect(contact?.whatsapp).toBe('393331234567');
    expect(contact?.agencyName).toContain('Roma');
  });

  it('discovers via warmed georeach session', async () => {
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
        request: async () => ({ status: 200, body: IDEALISTA_IT_FIXTURE_GEOREACH_JSON }),
        content: async () => IDEALISTA_IT_FIXTURE_SEARCH_HTML,
        pageUrl: () => 'https://www.idealista.it/affitto-case/roma/',
        exportStorageState: async () => ({ cookies: [] }),
        close: async () => undefined,
      }),
    };
    const local = new IdealistaItProvider({ runtime, cities: ['roma'] });
    const refs: ExternalListingRef[] = [];
    for await (const ref of local.discover({
      provider: 'idealista_it',
      market: 'IT',
      city: 'roma',
      limit: 10,
      runtime,
    })) {
      refs.push(ref);
    }
    expect(refs.map((r) => r.sourceId).sort()).toEqual(['87654321', '87654322', '87654323']);
  });
});

describe('ImmobiliareProvider', () => {
  const provider = new ImmobiliareProvider();

  it('parses __NEXT_DATA__ detail with contact', () => {
    const payload = parseImmobiliareDetail(
      IMMOBILIARE_FIXTURE_DETAIL_HTML,
      'https://www.immobiliare.it/annunci/112233445/',
    );
    const listing = provider.normalize({
      ref: { provider: 'immobiliare', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('immobiliare');
    expect(listing.sourceId).toBe('112233445');
    expect(listing.longTermRent?.monthlyAmount).toBe(1450);
    expect(listing.address.city).toBe('Roma');
    expect(listing.contact?.phone).toBeTruthy();
    expect(listing.contact?.agencyName).toContain('Centro');
    expect(listing.type).toBe(PropertyType.APARTMENT);
  });

  it('parses search JSON and HTML (JSON-first)', () => {
    expect(parseImmobiliareSearchJson(IMMOBILIARE_FIXTURE_SEARCH_JSON).map((r) => r.sourceId).sort()).toEqual([
      '112233445',
      '112233446',
      '112233447',
    ]);
    const fromHtml = parseImmobiliareSearch(IMMOBILIARE_FIXTURE_SEARCH_HTML);
    expect(fromHtml.some((r) => r.sourceId === '112233445')).toBe(true);
  });
});

describe('CasaItProvider', () => {
  const provider = new CasaItProvider();

  it('normalizes JSON-LD detail with contact script', () => {
    const payload = parseCasaItDetail(CASA_IT_FIXTURE_DETAIL_HTML, 'https://www.casa.it/immobili/123456789/');
    const listing = provider.normalize({
      ref: { provider: 'casa_it', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('casa_it');
    expect(listing.address.city).toBe('Milano');
    expect(listing.longTermRent?.monthlyAmount).toBe(2100);
    expect(listing.contact?.phone).toBeTruthy();
    expect(listing.contact?.email).toContain('casamilano');
  });

  it('parses search JSON and HTML', () => {
    expect(parseCasaItSearchJson(CASA_IT_FIXTURE_SEARCH_JSON).map((r) => r.sourceId).sort()).toEqual([
      '123456789',
      '123456790',
      '123456791',
    ]);
    expect(parseCasaItSearch(CASA_IT_FIXTURE_SEARCH_HTML).map((r) => r.sourceId).sort()).toEqual([
      '123456789',
      '123456790',
    ]);
  });
});

describe('SubitoProvider (housing-only)', () => {
  const provider = new SubitoProvider();

  it('normalizes a housing listing with contact', () => {
    const payload = parseSubitoDetail(
      SUBITO_FIXTURE_DETAIL_HTML,
      'https://www.subito.it/appartamenti/appartamento-a-milano-2-locali-milano-632623436.htm',
    );
    const listing = provider.normalize({
      ref: { provider: 'subito', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('subito');
    expect(listing.sourceId).toBe('632623436');
    expect(listing.longTermRent?.monthlyAmount).toBe(1000);
    expect(listing.address.city).toBe('Milano');
    expect(listing.bedrooms).toBe(2);
    expect(listing.squareFootage).toBe(51);
    expect(listing.furnishedStatus).toBe('furnished');
    expect(listing.contact?.phone).toBeTruthy();
    expect(listing.contact?.agencyName).toContain('Tempocasa');
    // Image CDN base gets the render `rule` query appended.
    expect(listing.remoteImages[0]?.url).toContain('rule=');
  });

  it('parses full search-page ad objects (features dict) and carries them via hints', () => {
    const listings = parseSubitoSearchListings(SUBITO_FIXTURE_SEARCH_HTML);
    // The car ad is filtered; only the two housing ads survive, both priced.
    expect(listings.map((l) => l.sourceId).sort()).toEqual(['632623436', '632623437']);
    expect(listings.every((l) => typeof l.price === 'number')).toBe(true);
    expect(listings.every((l) => isSubitoHousingCategory(l.categoryUri || l.url))).toBe(true);

    // A hint survives BullMQ JSON serialization and re-coerces to a SubitoRaw.
    const serialized = JSON.parse(JSON.stringify(listings[0])) as unknown;
    const coerced = coerceSubitoRaw(serialized);
    expect(coerced?.sourceId).toBe('632623436');
    expect(coerced?.price).toBe(1000);
    expect(coerceSubitoRaw({ sourceId: 'x' })).toBeUndefined();
  });

  it('discovers refs with hints and fetches without a detail request', async () => {
    let detailRequested = false;
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
      openBrowserSession: async ({ warmUrl }) => ({
        request: async () => {
          detailRequested = true;
          return { status: 200, body: '' };
        },
        content: async () => SUBITO_FIXTURE_SEARCH_HTML,
        pageUrl: () => warmUrl,
        warmNavigate: async () => undefined,
        exportStorageState: async () => ({ cookies: [] }),
        close: async () => undefined,
      }),
    };
    const local = new SubitoProvider({ runtime, cities: ['milano'] });
    const refs: ExternalListingRef[] = [];
    for await (const ref of local.discover({ provider: 'subito', market: 'IT', city: 'milano', limit: 5, runtime })) {
      refs.push(ref);
    }
    expect(refs.map((r) => r.sourceId).sort()).toEqual(['632623436', '632623437']);
    expect(refs[0]?.hints?.listing).toBeTruthy();

    const raw = await local.fetch(refs[0], { runtime });
    const listing = local.normalize(raw);
    expect(listing.sourceId).toBe(refs[0]?.sourceId);
    expect(listing.longTermRent?.monthlyAmount).toBeGreaterThan(0);
    // The hint payload means fetch never had to hit the (dead) detail page.
    expect(detailRequested).toBe(false);
  });

  it('rejects non-housing detail and filters cars from search JSON', () => {
    expect(() =>
      parseSubitoDetail(
        SUBITO_FIXTURE_NON_HOUSING_HTML,
        'https://www.subito.it/auto/fiat-punto-salerno-999888777.htm',
      ),
    ).toThrow(/non-housing/);

    const refs = parseSubitoSearchJson(SUBITO_FIXTURE_SEARCH_JSON);
    expect(refs.every((r) => isSubitoHousingCategory(r.url))).toBe(true);
    expect(refs.map((r) => r.sourceId).sort()).toEqual(['632623436', '632623437']);

    const htmlRefs = parseSubitoSearch(SUBITO_FIXTURE_SEARCH_HTML);
    expect(htmlRefs.every((r) => !r.url.includes('/auto/'))).toBe(true);
  });

  it('normalize throws on non-housing payload', () => {
    expect(() =>
      provider.normalize({
        ref: {
          provider: 'subito',
          sourceId: '999888777',
          url: 'https://www.subito.it/auto/fiat-punto-999888777.htm',
        },
        payload: {
          sourceId: '999888777',
          url: 'https://www.subito.it/auto/fiat-punto-999888777.htm',
          currency: 'EUR',
          operation: 'sale',
          categoryUri: '/auto',
          price: 3500,
          images: [],
        },
      }),
    ).toThrow(/non-housing/);
  });
});
