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
import { OfferingType } from '@homiio/shared-types';

const provider = new RedfinProvider();

describe('RedfinProvider', () => {
  it('parses GIS JSON with Stingray prefix', () => {
    const refs = parseRedfinGisResponse(`{}&&${JSON.stringify(REDFIN_GIS_FIXTURE)}`);
    expect(refs.length).toBe(2);
    expect(refs[1]?.kind).toBe('rent');
  });

  it('normalizes sale and rent homes', () => {
    const sale = parseRedfinDetailResponse(JSON.stringify({ payload: REDFIN_GIS_FIXTURE.payload.homes[0] }));
    const rent = parseRedfinDetailResponse(JSON.stringify({ payload: REDFIN_GIS_FIXTURE.payload.homes[1] }));
    if (!sale || !rent) throw new Error('fixtures missing');

    const saleListing = provider.normalize({
      ref: { provider: 'redfin', sourceId: String(sale.propertyId), url: 'https://x' },
      payload: { sourceId: String(sale.propertyId), url: 'https://x', kind: 'sale', home: sale },
    });
    expect(saleListing.sale?.price).toBe(425000);

    const rentListing = provider.normalize({
      ref: { provider: 'redfin', sourceId: String(rent.propertyId), url: 'https://x' },
      payload: { sourceId: String(rent.propertyId), url: 'https://x', kind: 'rent', home: rent },
    });
    expect(rentListing.longTermRent?.monthlyAmount).toBe(3150);
    expect(rentListing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
  });

  it('discovers via browser session GIS', async () => {
    const runtime: FetchRuntime = {
      async fetchHttp(): Promise<{ status: number; body: string }> {
        throw new Error('not used');
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
        request: async () => ({ status: 200, body: `{}&&${JSON.stringify(REDFIN_GIS_FIXTURE)}` }),
        exportStorageState: async () => ({ cookies: [] }),
        close: async () => undefined,
      }),
    };
    const refs: ExternalListingRef[] = [];
    for await (const ref of provider.discover({
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

  it('rejects invalid payload', () => {
    const bad: RawListing = { ref: { provider: 'redfin', sourceId: 'x', url: 'https://x' }, payload: {} };
    expect(() => provider.normalize(bad)).toThrow(/RedfinRaw/);
  });
});
