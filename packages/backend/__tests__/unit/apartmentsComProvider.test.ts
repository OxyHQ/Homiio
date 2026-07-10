/**
 * apartments.com provider contract test (pure — no DB, no live portal).
 *
 * Drives the `apartments_com` plugin from RECORDED HTML fixtures: the search
 * parser yields de-duplicated detail refs, the detail parser lifts the embedded
 * schema.org JSON-LD, and `normalize()` maps it onto a provider-agnostic,
 * published USD long-term rental. `discover()` is exercised against a fake
 * in-memory {@link FetchRuntime} so CI never scrapes.
 */

import {
  ApartmentsComProvider,
  APARTMENTS_COM_DETAIL_FIXTURES,
  APARTMENTS_COM_SEARCH_FIXTURE,
  parseApartmentsComDetail,
  parseApartmentsComSearch,
} from '@homiio/listing-providers';
import type {
  ExternalListingRef,
  FetchRuntime,
  RawListing,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new ApartmentsComProvider();

function ladderRuntime(pages: Map<string, string>): FetchRuntime {
  return {
    async fetchHttp(url: string): Promise<{ status: number; body: string }> {
      const html = pages.get(url);
      if (html === undefined) throw new Error(`ladderRuntime has no page for ${url}`);
      return { status: 200, body: html };
    },
    async fetchText(url: string): Promise<string> {
      const html = pages.get(url);
      if (html === undefined) throw new Error(`ladderRuntime has no page for ${url}`);
      return html;
    },
    async fetchJson<T = unknown>(): Promise<T> {
      throw new Error('apartments_com ladder runtime does not serve JSON');
    },
    async loadFixture<T = unknown>(): Promise<T> {
      throw new Error('apartments_com ladder runtime has no fixtures');
    },
    async fetchViaBrowser(url: string): Promise<string> {
      return this.fetchText(url);
    },
  };
}

const [harlow, gramercy] = APARTMENTS_COM_DETAIL_FIXTURES;

describe('ApartmentsComProvider', () => {
  it('declares the US market and apartments_com id', () => {
    expect(provider.id).toBe('apartments_com');
    expect(provider.markets).toEqual(['US']);
  });

  it('parses the search page into de-duplicated detail refs', () => {
    const refs = parseApartmentsComSearch(APARTMENTS_COM_SEARCH_FIXTURE);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(
      APARTMENTS_COM_DETAIL_FIXTURES.map((page) => page.sourceId).sort(),
    );
    for (const ref of refs) {
      expect(ref.provider).toBe('apartments_com');
      expect(ref.url.startsWith('https://www.apartments.com/')).toBe(true);
    }
  });

  it('discovers refs from a ladder-backed runtime, honouring the limit', async () => {
    const testProvider = new ApartmentsComProvider({
      runtime: ladderRuntime(new Map([['https://www.apartments.com/austin-tx/', APARTMENTS_COM_SEARCH_FIXTURE]])),
      ladderTiers: ['browser'],
    });
    const refs: ExternalListingRef[] = [];
    for await (const ref of testProvider.discover({
      provider: 'apartments_com',
      market: 'US',
      city: 'Austin, TX',
      limit: 1,
    })) {
      refs.push(ref);
    }
    expect(refs).toHaveLength(1);
  });

  it('fetch pulls detail HTML and extracts the JSON-LD listing', async () => {
    const runtime = ladderRuntime(new Map([[harlow.url, harlow.html]]));
    const testProvider = new ApartmentsComProvider({ runtime, ladderTiers: ['browser'] });
    const ref: ExternalListingRef = {
      provider: 'apartments_com',
      sourceId: harlow.sourceId,
      url: harlow.url,
    };
    const raw = await testProvider.fetch(ref, { runtime });
    const payload = raw.payload as { listing: { address: { locality?: string } } };
    expect(payload.listing.address.locality).toBe('Austin');
  });

  it('normalizes a priceRange complex into a published USD long-term rental', () => {
    const ref: ExternalListingRef = {
      provider: 'apartments_com',
      sourceId: harlow.sourceId,
      url: harlow.url,
    };
    const listing = provider.normalize({ ref, payload: parseApartmentsComDetail(harlow.html, ref) });

    expect(listing.source).toBe('apartments_com');
    expect(listing.sourceId).toBe(harlow.sourceId);
    expect(listing.sourceUrl).toBe(harlow.url);
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    // "$1,650 - $3,200" → the low bound is the listing's "from" price.
    expect(listing.longTermRent?.monthlyAmount).toBe(1650);
    expect(listing.longTermRent?.currency).toBe('USD');
    expect(listing.address.city).toBe('Austin');
    expect(listing.address.state).toBe('TX');
    expect(listing.address.country).toBe('United States');
    expect(listing.address.countryCode).toBe('US');
    expect(listing.address.coordinates).toEqual({ lat: 30.2617, lng: -97.7712 });
    expect(listing.bedrooms).toBe(2);
    expect(listing.bathrooms).toBe(2);
    expect(listing.squareFootage).toBe(980);
    expect(listing.remoteImages).toHaveLength(2);
    expect(listing.remoteImages.filter((image) => image.isPrimary)).toHaveLength(1);
  });

  it('normalizes a single-offer listing (price, not range)', () => {
    const ref: ExternalListingRef = {
      provider: 'apartments_com',
      sourceId: gramercy.sourceId,
      url: gramercy.url,
    };
    const listing = provider.normalize({ ref, payload: parseApartmentsComDetail(gramercy.html, ref) });
    expect(listing.longTermRent?.monthlyAmount).toBe(2100);
    expect(listing.address.city).toBe('Chicago');
    expect(listing.remoteImages).toHaveLength(1);
  });

  it('throws when the detail page has no schema.org listing', () => {
    const ref: ExternalListingRef = { provider: 'apartments_com', sourceId: 'x', url: 'https://x' };
    expect(() => parseApartmentsComDetail('<html><body>blocked</body></html>', ref)).toThrow(
      /no schema.org listing/,
    );
  });

  it('rejects a payload that is not an ApartmentsComRaw', () => {
    const bad: RawListing = {
      ref: { provider: 'apartments_com', sourceId: 'x', url: 'https://x' },
      payload: 42,
    };
    expect(() => provider.normalize(bad)).toThrow(/ApartmentsComRaw/);
  });

  it('reports healthy', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('apartments_com');
    expect(health.status).toBe('healthy');
  });
});
