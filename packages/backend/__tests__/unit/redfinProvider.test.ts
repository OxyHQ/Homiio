/**
 * Redfin provider contract test (pure — no DB, no live portal).
 */

import {
  RedfinProvider,
  REDFIN_GIS_FIXTURE,
  parseRedfinGisResponse,
  parseRedfinDetailResponse,
  stripStingrayPrefix,
} from '@homiio/listing-providers';
import type { ExternalListingRef, FetchRuntime, RawListing } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new RedfinProvider();

describe('RedfinProvider', () => {
  it('declares the US market and redfin id', () => {
    expect(provider.id).toBe('redfin');
    expect(provider.markets).toEqual(['US']);
  });

  it('strips the Stingray {}&& prefix before parsing', () => {
    const body = `{}&&${JSON.stringify(REDFIN_GIS_FIXTURE)}`;
    const refs = parseRedfinGisResponse(body);
    expect(refs.length).toBe(2);
    expect(refs[0]?.kind).toBe('sale');
    expect(refs[1]?.kind).toBe('rent');
  });

  it('parses GIS JSON without prefix', () => {
    const refs = parseRedfinGisResponse(JSON.stringify(REDFIN_GIS_FIXTURE));
    expect(refs[0]?.sourceId).toBe('184562901');
    expect(refs[0]?.url).toContain('redfin.com');
  });

  it('parses initialInfo detail payload', () => {
    const home = parseRedfinDetailResponse(
      stripStingrayPrefix(`{}&&${JSON.stringify({ payload: REDFIN_GIS_FIXTURE.payload.homes[0] })}`),
    );
    expect(home?.street).toBe('2100 San Jacinto Blvd');
    expect(home?.price).toBe(425000);
  });

  it('normalizes a for-sale home', () => {
    const home = parseRedfinDetailResponse(
      JSON.stringify({ payload: REDFIN_GIS_FIXTURE.payload.homes[0] }),
    );
    if (!home) throw new Error('fixture missing');
    const ref: ExternalListingRef = {
      provider: 'redfin',
      sourceId: String(home.propertyId),
      url: 'https://www.redfin.com/TX/Austin/example/home/184562901',
      hints: { kind: 'sale' },
    };
    const listing = provider.normalize({
      ref,
      payload: { sourceId: ref.sourceId, url: ref.url, kind: 'sale', home },
    });
    expect(listing.offerings).toEqual([OfferingType.SALE]);
    expect(listing.sale?.price).toBe(425000);
    expect(listing.type).toBe(PropertyType.HOUSE);
    expect(listing.address.state).toBe('TX');
  });

  it('normalizes a rental home', () => {
    const home = parseRedfinDetailResponse(
      JSON.stringify({ payload: REDFIN_GIS_FIXTURE.payload.homes[1] }),
    );
    if (!home) throw new Error('fixture missing');
    const ref: ExternalListingRef = {
      provider: 'redfin',
      sourceId: String(home.propertyId),
      url: 'https://www.redfin.com/TX/Austin/example/home/184562902',
      hints: { kind: 'rent' },
    };
    const listing = provider.normalize({
      ref,
      payload: { sourceId: ref.sourceId, url: ref.url, kind: 'rent', home },
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(3150);
  });

  it('discovers via warmed session Stingray GIS', async () => {
    const gisBody = `{}&&${JSON.stringify(REDFIN_GIS_FIXTURE)}`;
    const runtime: FetchRuntime = {
      async fetchHttp(): Promise<{ status: number; body: string }> {
        throw new Error('redfin discover should use session');
      },
      async fetchText(): Promise<string> {
        throw new Error('not used');
      },
      async fetchJson(): Promise<unknown> {
        throw new Error('not used');
      },
      async loadFixture(): Promise<unknown> {
        throw new Error('not used');
      },
      openBrowserSession: async () => ({
        pageUrl: () => 'https://www.redfin.com/city/30749/TX/Austin',
        request: async () => ({ status: 200, body: gisBody }),
        exportStorageState: async () => ({ cookies: [] }),
        close: async () => undefined,
      }),
    };
    const testProvider = new RedfinProvider({ runtime });
    const refs: ExternalListingRef[] = [];
    for await (const ref of testProvider.discover({
      provider: 'redfin',
      market: 'US',
      city: 'Austin, TX',
      limit: 5,
      runtime,
    })) {
      refs.push(ref);
    }
    expect(refs.length).toBe(2);
  });

  it('rejects a payload that is not a RedfinRaw', () => {
    const bad: RawListing = {
      ref: { provider: 'redfin', sourceId: 'x', url: 'https://x' },
      payload: {},
    };
    expect(() => provider.normalize(bad)).toThrow(/RedfinRaw/);
  });
});
