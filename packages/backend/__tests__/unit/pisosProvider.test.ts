/**
 * pisos.com provider contract test (pure — no DB, no network).
 */

import {
  PisosProvider,
  parsePisosDetail,
  parsePisosSearch,
  parsePisosContactPhone,
  mergePisosContact,
  pisosSourceIdFromUrl,
  PISOS_FIXTURE_DETAIL_HTML,
  PISOS_FIXTURE_DETAIL_VALLADOLID_HTML,
  PISOS_FIXTURE_SEARCH_HTML,
  PISOS_FIXTURE_CONTACT_JSON,
} from '@homiio/listing-providers';
import type { ExternalListingRef, FetchRuntime } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new PisosProvider();

describe('PisosProvider.normalize', () => {
  it('maps embedded detail JSON into a published long-term-rent listing with contact', () => {
    const payload = parsePisosDetail(
      PISOS_FIXTURE_DETAIL_HTML,
      'https://www.pisos.com/alquilar/piso-sol_barrio28012-20026385030_992099/',
    );
    const ref: ExternalListingRef = { provider: 'pisos', sourceId: payload.sourceId, url: payload.url };
    const listing = provider.normalize({ ref, payload });

    expect(listing.source).toBe('pisos');
    expect(listing.sourceId).toBe('20026385030.992099');
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(2550);
    expect(listing.longTermRent?.currency).toBe('EUR');
    expect(listing.bedrooms).toBe(2);
    expect(listing.bathrooms).toBe(2);
    expect(listing.squareFootage).toBe(107);
    expect(listing.contact?.phone).toBe('919376345');
    expect(listing.contact?.kind).toBe('agency');
    expect(listing.remoteImages.length).toBeGreaterThan(0);
    expect(listing.amenities).toEqual(expect.arrayContaining(['ascensor', 'balcon', 'soleado']));
    expect(listing.address.city).toBe('Madrid Capital');
    expect(listing.address.coordinates).toEqual({ lat: 40.41593545782718, lng: -3.7083892232908435 });
  });

  it('assigns distinct portal coordinates and cities for two detail fixtures', () => {
    const madridPayload = parsePisosDetail(
      PISOS_FIXTURE_DETAIL_HTML,
      'https://www.pisos.com/alquilar/piso-sol_barrio28012-20026385030_992099/',
    );
    const valladolidPayload = parsePisosDetail(
      PISOS_FIXTURE_DETAIL_VALLADOLID_HTML,
      'https://www.pisos.com/alquilar/piso-valladolid_capital_universidad-65009504308_106400/',
    );
    const madrid = provider.normalize({
      ref: { provider: 'pisos', sourceId: madridPayload.sourceId, url: madridPayload.url },
      payload: madridPayload,
    });
    const valladolid = provider.normalize({
      ref: { provider: 'pisos', sourceId: valladolidPayload.sourceId, url: valladolidPayload.url },
      payload: valladolidPayload,
    });

    expect(madrid.address.city).toBe('Madrid Capital');
    expect(valladolid.address.city).toBe('Valladolid Capital');
    expect(madrid.address.coordinates).toEqual({ lat: 40.41593545782718, lng: -3.7083892232908435 });
    expect(valladolid.address.coordinates).toEqual({ lat: 41.6531628, lng: -4.7216201 });
    expect(madrid.address.coordinates).not.toEqual(valladolid.address.coordinates);
  });

  it('parses contact AJAX JSON', () => {
    expect(parsePisosContactPhone(PISOS_FIXTURE_CONTACT_JSON)).toBe('+34919376345');
  });

  it('keeps embedded phone when contact AJAX returns null', () => {
    const raw = parsePisosDetail(
      PISOS_FIXTURE_DETAIL_HTML,
      'https://www.pisos.com/alquilar/piso-sol_barrio28012-20026385030_992099/',
    );
    const merged = mergePisosContact(raw, parsePisosContactPhone('{"phone":null}'));
    expect(merged.contact?.phone).toBe('919376345');
  });
});

describe('PisosProvider search + helpers', () => {
  it('parses de-duplicated JSON-LD refs from a search page', () => {
    const refs = parsePisosSearch(PISOS_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBe(3);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual([
      '20026385030.992099',
      '61688075258.280500',
      '65072508446.519513',
    ]);
    for (const ref of refs) {
      expect(ref.url.startsWith('https://www.pisos.com/')).toBe(true);
    }
  });

  it('extracts a source id from a detail url', () => {
    expect(
      pisosSourceIdFromUrl('https://www.pisos.com/alquilar/piso-sol_barrio28012-20026385030_992099/'),
    ).toBe('20026385030.992099');
  });
});

describe('PisosProvider.discover', () => {
  it('yields refs from cold HTTP JSON-LD without opening a browser session', async () => {
    let sessionsOpened = 0;
    const runtime: FetchRuntime = {
      fetchHttp: async () => ({ status: 200, body: PISOS_FIXTURE_SEARCH_HTML }),
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
        sessionsOpened += 1;
        throw new Error('browser should not be needed');
      },
    };

    const local = new PisosProvider({ runtime, cities: ['madrid'] });
    const refs: ExternalListingRef[] = [];
    for await (const ref of local.discover({
      provider: 'pisos',
      market: 'ES',
      city: 'madrid',
      limit: 10,
      runtime,
    })) {
      refs.push(ref);
    }

    expect(sessionsOpened).toBe(0);
    expect(refs.length).toBe(3);
    expect(refs.every((ref) => ref.provider === 'pisos')).toBe(true);
  });

  it('falls back to a warmed session when HTTP search is challenged', async () => {
    const runtime: FetchRuntime = {
      fetchHttp: async () => ({ status: 403, body: 'access denied' }),
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
        content: async () => PISOS_FIXTURE_SEARCH_HTML,
        pageUrl: () => 'https://www.pisos.com/alquiler/pisos-madrid/',
        warmNavigate: async () => undefined,
        request: async () => ({ status: 200, body: '{}' }),
        exportStorageState: async () => ({ cookies: [] }),
        close: async () => undefined,
      }),
    };

    const local = new PisosProvider({ runtime, cities: ['madrid'] });
    const refs: ExternalListingRef[] = [];
    for await (const ref of local.discover({
      provider: 'pisos',
      market: 'ES',
      city: 'madrid',
      limit: 5,
      runtime,
    })) {
      refs.push(ref);
    }

    expect(refs.length).toBe(3);
  });
});
