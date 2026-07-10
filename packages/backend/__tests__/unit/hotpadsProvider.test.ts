/**
 * HotPads provider contract test (pure — no DB, no live portal).
 */

import {
  HotpadsProvider,
  HOTPADS_AREA_FIXTURE,
  HOTPADS_LISTING_FIXTURE,
  HOTPADS_SEARCH_FIXTURE,
  parseHotpadsSearch,
  parseHotpadsListingById,
} from '@homiio/listing-providers';
import type { ExternalListingRef, FetchRuntime, RawListing } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new HotpadsProvider();

function hotpadsRuntime(pages: Map<string, string>): FetchRuntime {
  return {
    async fetchHttp(url: string): Promise<{ status: number; body: string }> {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`hotpadsRuntime has no page for ${url}`);
      return { status: 200, body };
    },
    async fetchText(url: string): Promise<string> {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`hotpadsRuntime has no page for ${url}`);
      return body;
    },
    async fetchJson(): Promise<unknown> {
      throw new Error('not used');
    },
    async loadFixture(): Promise<unknown> {
      throw new Error('not used');
    },
  };
}

describe('HotpadsProvider', () => {
  it('declares the US market and hotpads id', () => {
    expect(provider.id).toBe('hotpads');
    expect(provider.markets).toEqual(['US']);
  });

  it('parses search JSON into listing refs', () => {
    const refs = parseHotpadsSearch(JSON.stringify(HOTPADS_SEARCH_FIXTURE));
    expect(refs).toHaveLength(1);
    expect(refs[0]?.sourceId).toBe(HOTPADS_LISTING_FIXTURE.aliasEncoded);
    expect(refs[0]?.url).toContain('hotpads.com');
  });

  it('finds a listing by alias in search JSON', () => {
    const listing = parseHotpadsListingById(
      JSON.stringify(HOTPADS_SEARCH_FIXTURE),
      HOTPADS_LISTING_FIXTURE.aliasEncoded,
    );
    expect(listing?.title).toBe('Alexan Braker Pointe');
  });

  it('normalizes a fixture into a published USD long-term rental', () => {
    const ref: ExternalListingRef = {
      provider: 'hotpads',
      sourceId: HOTPADS_LISTING_FIXTURE.aliasEncoded,
      url: 'https://hotpads.com/example/pad',
    };
    const listing = provider.normalize({
      ref,
      payload: {
        sourceId: ref.sourceId,
        url: ref.url,
        listing: HOTPADS_LISTING_FIXTURE,
      },
    });
    expect(listing.source).toBe('hotpads');
    expect(listing.status).toBe('published');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1728);
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.address.city).toBe('Austin');
    expect(listing.remoteImages.length).toBeGreaterThan(0);
  });

  it('rejects a payload that is not a HotpadsRaw', () => {
    const bad: RawListing = {
      ref: { provider: 'hotpads', sourceId: 'x', url: 'https://x' },
      payload: null,
    };
    expect(() => provider.normalize(bad)).toThrow(/HotpadsRaw/);
  });

  it('discovers from area + listings API responses', async () => {
    const areaUrl =
      'https://hotpads-api-gke-prod-1-west-20250228-public.hotpads.com/hotpads-api/api/v2/area/byResourceId?resourceId=austin-tx';
    const listUrl =
      'https://hotpads-api-gke-prod-1-west-20250228-public.hotpads.com/hotpads-api/api/v2/listing/byCoordsV2?areas=216213232&minLat=30.06787&maxLat=30.51948&minLon=-98.090558&maxLon=-97.541748&searchSlug=apartments-for-rent&listingTypes=rental%2Croom%2Csublet%2Ccorporate&propertyTypes=condo%2Cdivided%2Cgarden%2Chouse%2Clarge%2Cmedium%2Ctownhouse&orderBy=score&limit=200&components=basic%2Cuseritem%2Cquality%2Cmodel%2Cphotos&trimResponse=true';
    const runtime = hotpadsRuntime(
      new Map([
        [areaUrl, JSON.stringify(HOTPADS_AREA_FIXTURE)],
        [listUrl, JSON.stringify(HOTPADS_SEARCH_FIXTURE)],
      ]),
    );
    const testProvider = new HotpadsProvider({ runtime });
    const refs: ExternalListingRef[] = [];
    for await (const ref of testProvider.discover({
      provider: 'hotpads',
      market: 'US',
      city: 'Austin, TX',
      limit: 5,
      runtime,
    })) {
      refs.push(ref);
    }
    expect(refs.length).toBe(1);
  });
});
