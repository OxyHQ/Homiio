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
  readPisosImageUrls,
  PISOS_FIXTURE_DETAIL_HTML,
  PISOS_FIXTURE_DETAIL_VALLADOLID_HTML,
  PISOS_FIXTURE_DETAIL_VTMVARS_HTML,
  PISOS_FIXTURE_DETAIL_IMAGES_HTML,
  PISOS_FIXTURE_DETAIL_IMAGES_EXPECTED,
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
    expect(listing.floor).toBe(3);
    expect(listing.yearBuilt).toBe(1998);
    expect(listing.parkingSpaces).toBe(1);
    expect(listing.contact?.phone).toBe('919376345');
    expect(listing.contact?.kind).toBe('agency');
    expect(listing.remoteImages.length).toBeGreaterThan(0);
    // Raw ES slugs canonicalized (`ascensor`→elevator, `balcon`→balcony); the
    // non-amenity `soleado` is dropped.
    expect(listing.amenities).toEqual(['elevator', 'balcony']);
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
    // Valladolid's trimmed `data-var` omits planta / año / plazas — stay undefined.
    expect(valladolid.floor).toBeUndefined();
    expect(valladolid.yearBuilt).toBeUndefined();
    expect(valladolid.parkingSpaces).toBeUndefined();
  });

  it('rejects non-numeric floor and age-encoded antiguedad instead of fabricating values', () => {
    const bogusHtml = PISOS_FIXTURE_DETAIL_HTML.replace(
      '"planta":"3","anioConstruccion":"1998","nPlazasGaraje":"1"',
      '"planta":"Bajo","anioConstruccion":"antigua","antiguedad":"30 años"',
    );
    const payload = parsePisosDetail(
      bogusHtml,
      'https://www.pisos.com/alquilar/piso-sol_barrio28012-20026385030_992099/',
    );
    const listing = provider.normalize({
      ref: { provider: 'pisos', sourceId: payload.sourceId, url: payload.url },
      payload,
    });

    expect(listing.floor).toBeUndefined();
    expect(listing.yearBuilt).toBeUndefined();
    expect(listing.parkingSpaces).toBeUndefined();
  });

  it('drops the pisos.com-watermarked cover duplicate and agency logo, keeping one clean copy per photo', () => {
    // Live listings serve each photo under several size prefixes: `xl-wp` /
    // `fch-wp` covers and `appswm-wp` carry the burned-in pisos.com watermark,
    // while `apps-wp` + `fchm-wp` are clean and `prof-wp/logos/…` is the agency
    // logo. The parser must ingest only the clean, de-duplicated gallery.
    const urls = readPisosImageUrls(PISOS_FIXTURE_DETAIL_IMAGES_HTML);

    expect(urls).toEqual(PISOS_FIXTURE_DETAIL_IMAGES_EXPECTED);
    // The clean `apps-wp` copy of the first photo leads (its watermarked
    // `xl-wp` og:image twin, which appears first in the HTML, is discarded).
    expect(urls[0]).toContain('/apps-wp/');
    // No watermarked or logo rendition survives.
    expect(urls.some((url) => /\/(?:xl-wp|fch-wp|appswm-wp)\//.test(url))).toBe(false);
    expect(urls.some((url) => url.includes('/logos/'))).toBe(false);
    // Each underlying photo appears exactly once (no size-variant duplicates).
    const photoKeys = urls.map((url) => url.replace(/^https:\/\/[^/]+\/[^/]+\//, ''));
    expect(new Set(photoKeys).size).toBe(photoKeys.length);
  });

  it('normalizes the images fixture into watermark-free remoteImages with a clean primary', () => {
    const payload = parsePisosDetail(
      PISOS_FIXTURE_DETAIL_IMAGES_HTML,
      'https://www.pisos.com/alquilar/piso-alboraia_alboraya_centro_urbano-65023401382_106400/',
    );
    const listing = provider.normalize({
      ref: { provider: 'pisos', sourceId: payload.sourceId, url: payload.url },
      payload,
    });

    expect(listing.remoteImages).toHaveLength(PISOS_FIXTURE_DETAIL_IMAGES_EXPECTED.length);
    expect(listing.remoteImages[0]?.isPrimary).toBe(true);
    expect(listing.remoteImages[0]?.url).toContain('/apps-wp/');
    expect(
      listing.remoteImages.some((image) => /\/(?:xl-wp|fch-wp|appswm-wp)\//.test(image.url)),
    ).toBe(false);
    expect(listing.remoteImages.some((image) => image.url.includes('/logos/'))).toBe(false);
  });

  it('resolves price from the vtmExtraVars blob and city from the title (live template)', () => {
    // Real captured template that dropped in prod: the tracking payload moved
    // into the `id="vtmExtraVars"` data-var blob (no `window.__pisosTrack`, no
    // `var precio`), and the municipality renders as a `descending-geo` picker
    // with no ascending named row. Price (1200, from vtmExtraVars) and city
    // ("Picanya", from the <title>) come from the sources the parser ignored.
    const payload = parsePisosDetail(
      PISOS_FIXTURE_DETAIL_VTMVARS_HTML,
      'https://www.pisos.com/alquilar/apartamento-picanya_centro_urbano-65071648575_100900/',
    );
    const listing = provider.normalize({
      ref: { provider: 'pisos', sourceId: payload.sourceId, url: payload.url },
      payload,
    });

    expect(listing.sourceId).toBe('65071648575.100900');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1200);
    expect(listing.address.city).toBe('Picanya');
    expect(listing.address.state).toBe('València');
    expect(listing.address.coordinates).toEqual({ lat: 39.43443131, lng: -0.432955807 });
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.bedrooms).toBe(3);
    expect(listing.bathrooms).toBe(2);
    expect(listing.squareFootage).toBe(90);
    expect(listing.furnishedStatus).toBe('furnished');
    expect(listing.contact?.phone).toBe('961234567');
    expect(listing.contact?.kind).toBe('agency');
  });

  it('recovers the city from the title when the breadcrumb is entirely absent', () => {
    // Hardest prod "no resolvable city" case: an agency template with NO
    // ascending-geo breadcrumb at all — only the <title> carries the municipality.
    const navStart = PISOS_FIXTURE_DETAIL_VTMVARS_HTML.indexOf('<nav class="ascending-geo">');
    const navEnd = PISOS_FIXTURE_DETAIL_VTMVARS_HTML.indexOf('</nav>') + '</nav>'.length;
    const noBreadcrumb =
      PISOS_FIXTURE_DETAIL_VTMVARS_HTML.slice(0, navStart) +
      PISOS_FIXTURE_DETAIL_VTMVARS_HTML.slice(navEnd);

    const payload = parsePisosDetail(
      noBreadcrumb,
      'https://www.pisos.com/alquilar/apartamento-picanya_centro_urbano-65071648575_100900/',
    );
    expect(payload.listing.address.city).toBe('Picanya');
    expect(payload.listing.price).toBe(1200);
  });

  it('recovers the price from the title when the data-var blob omits it', () => {
    // "no resolvable price" case: no __pisosTrack, no `var precio`, and the
    // vtmExtraVars blob has an empty price — only the "por 1.200 €/mes" title
    // clause carries it.
    const noBlobPrice = PISOS_FIXTURE_DETAIL_VTMVARS_HTML.replace(
      '"precioInmueble":"1200","precio":"1200","tipoVendedor"',
      '"precioInmueble":"","precio":"","tipoVendedor"',
    );
    const payload = parsePisosDetail(
      noBlobPrice,
      'https://www.pisos.com/alquilar/apartamento-picanya_centro_urbano-65071648575_100900/',
    );
    expect(payload.listing.price).toBe(1200);
    expect(payload.listing.address.city).toBe('Picanya');
  });

  it('does not mistake the operation word for a city in a location-less title', () => {
    // "Piso en alquiler por 850 €/mes" leaves only "alquiler" after the last
    // " en " — it must be rejected so the province (València) wins, never stored
    // as a city called "alquiler".
    const locationlessTitle = PISOS_FIXTURE_DETAIL_VTMVARS_HTML.replace(
      'Apartamento en alquiler en Carrer de la Senyera en Picanya por 1.200 €/mes',
      'Piso en alquiler por 850 €/mes',
    );
    const payload = parsePisosDetail(
      locationlessTitle,
      'https://www.pisos.com/alquilar/apartamento-picanya_centro_urbano-65071648575_100900/',
    );
    expect(payload.listing.address.city).toBe('València');
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
