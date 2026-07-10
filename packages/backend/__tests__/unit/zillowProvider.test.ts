/**
 * Zillow provider contract test (pure — no DB, no live portal).
 *
 * Drives the `zillow` plugin from RECORDED HTML fixtures for BOTH a for-rent
 * and a for-sale home-details page: the search parser yields de-duplicated
 * refs tagged with the buy/rent intent, the detail parser lifts the embedded
 * schema.org JSON-LD, and `normalize()` maps it onto a published USD long-term
 * rental or sale accordingly. `discover()` runs against a fake in-memory
 * {@link FetchRuntime} so CI never scrapes.
 */

import {
  ZillowProvider,
  ZILLOW_DETAIL_FIXTURES,
  ZILLOW_SEARCH_FIXTURE,
  parseZillowDetail,
  parseZillowSearch,
} from '@homiio/listing-providers';
import type {
  ExternalListingRef,
  FetchRuntime,
  RawListing,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new ZillowProvider();

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
      throw new Error('zillow ladder runtime does not serve JSON');
    },
    async loadFixture<T = unknown>(): Promise<T> {
      throw new Error('zillow ladder runtime has no fixtures');
    },
    async fetchViaBrowser(url: string): Promise<string> {
      return this.fetchText(url);
    },
  };
}

const rentPage = ZILLOW_DETAIL_FIXTURES.find((page) => page.kind === 'rent');
const salePage = ZILLOW_DETAIL_FIXTURES.find((page) => page.kind === 'sale');

if (!rentPage || !salePage) {
  throw new Error('Zillow fixtures must include a rent AND a sale page');
}

describe('ZillowProvider', () => {
  it('declares the US market and zillow id', () => {
    expect(provider.id).toBe('zillow');
    expect(provider.markets).toEqual(['US']);
  });

  it('parses the search page into refs tagged with the rent intent', () => {
    const refs = parseZillowSearch(ZILLOW_SEARCH_FIXTURE, 'rent');
    expect(refs.map((ref) => ref.sourceId)).toContain(rentPage.sourceId);
    for (const ref of refs) {
      expect(ref.provider).toBe('zillow');
      expect(ref.hints?.kind).toBe('rent');
      expect(/\/\d+_zpid\/$/.test(ref.url)).toBe(true);
    }
  });

  it('discovers refs from a ladder-backed runtime, honouring the limit', async () => {
    const testProvider = new ZillowProvider({
      runtime: ladderRuntime(
        new Map([['https://www.zillow.com/homes/for_rent/portland-or/', ZILLOW_SEARCH_FIXTURE]]),
      ),
      ladderTiers: ['browser'],
    });
    const refs: ExternalListingRef[] = [];
    for await (const ref of testProvider.discover({
      provider: 'zillow',
      market: 'US',
      city: 'Portland, OR',
      limit: 5,
    })) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0]?.hints?.kind).toBe('rent');
  });

  it('fetch pulls detail HTML through the ladder runtime', async () => {
    const runtime = ladderRuntime(new Map([[rentPage.url, rentPage.html]]));
    const testProvider = new ZillowProvider({ runtime, ladderTiers: ['browser'] });
    const ref: ExternalListingRef = {
      provider: 'zillow',
      sourceId: rentPage.sourceId,
      url: rentPage.url,
      hints: { kind: 'rent' },
    };
    const raw = await testProvider.fetch(ref, { runtime });
    expect((raw.payload as { listing: { address: { locality?: string } } }).listing.address.locality).toBe(
      'Portland',
    );
  });

  it('normalizes a for-rent apartment into a published long-term rental', () => {
    const ref: ExternalListingRef = {
      provider: 'zillow',
      sourceId: rentPage.sourceId,
      url: rentPage.url,
      hints: { kind: 'rent' },
    };
    const listing = provider.normalize({ ref, payload: parseZillowDetail(rentPage.html, ref) });

    expect(listing.source).toBe('zillow');
    expect(listing.sourceId).toBe(rentPage.sourceId);
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(2450);
    expect(listing.longTermRent?.currency).toBe('USD');
    expect(listing.sale).toBeUndefined();
    expect(listing.address.city).toBe('Portland');
    expect(listing.address.state).toBe('OR');
    expect(listing.address.countryCode).toBe('US');
    expect(listing.address.coordinates).toEqual({ lat: 45.5289, lng: -122.6836 });
    expect(listing.bedrooms).toBe(2);
    expect(listing.remoteImages).toHaveLength(2);
    expect(listing.remoteImages.filter((image) => image.isPrimary)).toHaveLength(1);
  });

  it('normalizes a for-sale single-family home into a published sale', () => {
    const ref: ExternalListingRef = {
      provider: 'zillow',
      sourceId: salePage.sourceId,
      url: salePage.url,
      hints: { kind: 'sale' },
    };
    const listing = provider.normalize({ ref, payload: parseZillowDetail(salePage.html, ref) });

    expect(listing.type).toBe(PropertyType.HOUSE);
    expect(listing.offerings).toEqual([OfferingType.SALE]);
    expect(listing.sale?.price).toBe(615000);
    expect(listing.sale?.currency).toBe('USD');
    expect(listing.longTermRent).toBeUndefined();
    expect(listing.address.city).toBe('Denver');
    expect(listing.squareFootage).toBe(1780);
  });

  it('throws when the detail page has no schema.org listing', () => {
    const ref: ExternalListingRef = { provider: 'zillow', sourceId: 'x', url: 'https://x' };
    expect(() => parseZillowDetail('<html><body>px-captcha</body></html>', ref)).toThrow(
      /no schema.org listing/,
    );
  });

  it('rejects a payload that is not a ZillowRaw', () => {
    const bad: RawListing = {
      ref: { provider: 'zillow', sourceId: 'x', url: 'https://x' },
      payload: 42,
    };
    expect(() => provider.normalize(bad)).toThrow(/ZillowRaw/);
  });

  it('reports healthy', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('zillow');
    expect(health.status).toBe('healthy');
  });
});
