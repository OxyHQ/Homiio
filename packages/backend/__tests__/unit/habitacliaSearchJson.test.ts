/**
 * Habitaclia's search payload: reading it, mapping it, and — the part that
 * actually cost us a market — refusing to mistake an unreadable page for an
 * empty city.
 *
 * Every fixture here is trimmed from a LIVE page captured through the
 * production proxy, nulls and upper-snake enums intact. See `searchFixtures.ts`.
 */

import {
  extractAdevintaInitialProps,
  habitacliaListingFromSearchItem,
  parseHabitacliaSearchJson,
  ADEVINTA_SEARCH_JSON_SCRIPT_TAG_HTML,
  HABITACLIA_SEARCH_JSON_HTML,
  HABITACLIA_SEARCH_TRUNCATED_HTML,
  HABITACLIA_SEARCH_UNREADABLE_HTML,
} from '@homiio/listing-providers';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('extractAdevintaInitialProps', () => {
  it('reads both wrappers the two portals use for the same payload', () => {
    // Habitaclia inlines `JSON.parse("…")`; Fotocasa ships a JSON script tag.
    // They run the same front end and disagree only here, so an extractor that
    // handles one silently yields nothing on the other.
    for (const html of [HABITACLIA_SEARCH_JSON_HTML, ADEVINTA_SEARCH_JSON_SCRIPT_TAG_HTML]) {
      expect(extractAdevintaInitialProps(html)).toBeDefined();
    }
  });

  it('returns undefined rather than a half-read page when the literal is cut off', () => {
    // A truncated response must fail closed. Yielding a partial object here
    // would put half a search page into the queue and call it a success.
    expect(extractAdevintaInitialProps(HABITACLIA_SEARCH_TRUNCATED_HTML)).toBeUndefined();
  });

  it('returns undefined for a page carrying no payload at all', () => {
    expect(extractAdevintaInitialProps(HABITACLIA_SEARCH_UNREADABLE_HTML)).toBeUndefined();
    expect(extractAdevintaInitialProps('')).toBeUndefined();
  });
});

describe('parseHabitacliaSearchJson', () => {
  it('distinguishes "cannot read this page" from "this city has no homes"', () => {
    // THE BUG THIS FILE EXISTS FOR. The 2026-09 redesign left the old card
    // selectors matching nothing, so every Spanish city parsed to zero refs and
    // was reported as exhausted — twelve consecutive discover jobs, no error,
    // no metric, Spain stuck at 31 listings against Germany's 481.
    //
    // `undefined` and `{ refs: [] }` must therefore never be the same value.
    expect(parseHabitacliaSearchJson(HABITACLIA_SEARCH_UNREADABLE_HTML)).toBeUndefined();

    const page = parseHabitacliaSearchJson(HABITACLIA_SEARCH_JSON_HTML);
    expect(page).toBeDefined();
    expect(page?.refs.length).toBe(3);
  });

  it('reports the portal’s own page count so discover can stop early', () => {
    const page = parseHabitacliaSearchJson(HABITACLIA_SEARCH_JSON_HTML);
    expect(page?.totalPages).toBe(109);
    expect(page?.totalCount).toBe(3269);
  });

  it('keys identity on the legacy numeric id, not the UUID', () => {
    // `(source, sourceId)` is the upsert key and every Habitaclia row already
    // stored was keyed by the digits in `…-i<digits>.htm`. The item also
    // carries a UUID `id`; keying on that would re-import the entire Spanish
    // catalogue as new rows beside the old ones instead of updating them.
    const page = parseHabitacliaSearchJson(HABITACLIA_SEARCH_JSON_HTML);
    for (const ref of page?.refs ?? []) {
      expect(ref.sourceId).toMatch(/^\d{6,}$/);
      expect(ref.url).toContain(ref.sourceId);
    }
  });

  it('drops the tracking query from the stored source URL', () => {
    // `navigationUrl` arrives as `/i<id>.htm?from=list`. That query is not part
    // of the listing's identity and `sourceUrl` is a link real people click.
    for (const ref of parseHabitacliaSearchJson(HABITACLIA_SEARCH_JSON_HTML)?.refs ?? []) {
      expect(ref.url).not.toContain('?');
      expect(ref.url.startsWith('https://www.habitaclia.com/')).toBe(true);
    }
  });

  it('carries a mapped listing on every ref, so fetch needs no network', () => {
    const page = parseHabitacliaSearchJson(HABITACLIA_SEARCH_JSON_HTML);
    expect(page?.refs.every((ref) => ref.listing !== undefined)).toBe(true);
  });
});

describe('habitacliaListingFromSearchItem', () => {
  function listings() {
    return (parseHabitacliaSearchJson(HABITACLIA_SEARCH_JSON_HTML)?.refs ?? []).map(
      (ref) => ref.listing!,
    );
  }

  it('keeps ground floor as 0 and refuses to invent one for a penthouse', () => {
    // `floor` is optional and the two absences are different facts: `undefined`
    // is "nobody said", `0` is "ground floor" — something renters filter on.
    // The fixture holds a GROUND_FLOOR, a PENTHOUSE and a FIRST for exactly
    // this assertion; `0024_floor_not_stated` is why it matters.
    const floors = listings().map((listing) => listing.floor);
    expect(floors).toContain(0);
    expect(floors).toContain(1);
    expect(floors).toContain(undefined);
  });

  it('defaults a null currency to EUR', () => {
    // The portal returns `currency: null` on every Spanish listing observed —
    // a statement about its own UI, not about the money.
    for (const listing of listings()) {
      expect(listing.currency).toBe('EUR');
      expect(listing.price).toBeGreaterThan(0);
    }
  });

  it('captures the advertiser contact the detail page never exposed', () => {
    // AGENTS.md asks for portal-exposed contacts and forbids inventing them.
    const withContact = listings().filter((listing) => listing.contact);
    expect(withContact.length).toBeGreaterThan(0);
    for (const listing of withContact) {
      expect(listing.contact?.phone ?? listing.contact?.email).toBeTruthy();
    }
  });

  it('prefers the neighbourhood layer over the wider district', () => {
    // A district is several neighbourhoods wide; the layer is the name a
    // resident would use.
    expect(listings().some((listing) => Boolean(listing.address.neighborhood))).toBe(true);
  });

  it('honours the shared image cap instead of its own number', () => {
    // Carrying more images than the ingest keeps is waste twice over: the
    // surplus rides through Redis in every job payload and is dropped on
    // arrival. Measured on live pages, images are the largest part of a carried
    // listing.
    process.env.LISTING_MAX_IMAGES_PER_LISTING = '1';
    for (const listing of listings()) {
      expect(listing.images.length).toBeLessThanOrEqual(1);
    }
  });

  it('marks exactly one image primary', () => {
    for (const listing of listings()) {
      expect(listing.images.filter((image) => image.isPrimary)).toHaveLength(1);
    }
  });

  it('rejects an item with no usable price rather than importing a free home', () => {
    expect(habitacliaListingFromSearchItem({ legacyNumericId: '123456789' })).toBeUndefined();
    expect(
      habitacliaListingFromSearchItem({
        legacyNumericId: '123456789',
        transaction: { type: 'rent', price: { amount: 0 } },
      }),
    ).toBeUndefined();
  });

  it('rejects an item with no legacy id, since it could not be keyed', () => {
    expect(
      habitacliaListingFromSearchItem({
        id: 'a-uuid-only',
        transaction: { type: 'rent', price: { amount: 1200 } },
      }),
    ).toBeUndefined();
  });

  it('survives a garbage item without throwing', () => {
    for (const value of [undefined, null, 42, 'text', [], {}]) {
      expect(habitacliaListingFromSearchItem(value)).toBeUndefined();
    }
  });
});
