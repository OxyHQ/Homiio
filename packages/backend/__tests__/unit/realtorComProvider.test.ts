/**
 * realtor.com provider contract test (pure — no DB, no live portal).
 */

import {
  RealtorComProvider,
  REALTOR_COM_RENT_FIXTURE,
  REALTOR_COM_SALE_FIXTURE,
  REALTOR_COM_SEARCH_FIXTURE,
  parseRealtorSearchResponse,
} from '@homiio/listing-providers';
import type { ExternalListingRef, FetchRuntime, RawListing } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new RealtorComProvider();

function graphqlRuntime(responses: Map<string, string>): FetchRuntime {
  return {
    async fetchHttp(_url: string, init?: { body?: string }): Promise<{ status: number; body: string }> {
      const op = init?.body?.includes('ConsumerSearchMainQuery')
        ? 'search'
        : init?.body?.includes('HomeDetails')
          ? 'detail'
          : 'unknown';
      const body = responses.get(op);
      if (body === undefined) throw new Error(`graphqlRuntime missing response for ${op}`);
      return { status: 200, body };
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
  };
}

describe('RealtorComProvider', () => {
  it('parses search GraphQL into refs with rent/sale kinds', () => {
    const refs = parseRealtorSearchResponse(JSON.stringify(REALTOR_COM_SEARCH_FIXTURE));
    expect(refs[0]?.kind).toBe('rent');
    expect(refs[1]?.kind).toBe('sale');
  });

  it('normalizes a for-rent listing using list_price_min', () => {
    const ref: ExternalListingRef = {
      provider: 'realtor_com',
      sourceId: REALTOR_COM_RENT_FIXTURE.property_id,
      url: 'https://www.realtor.com/realestateandhomes-detail/x',
      hints: { kind: 'rent' },
    };
    const listing = provider.normalize({
      ref,
      payload: { sourceId: ref.sourceId, url: ref.url, kind: 'rent', listing: REALTOR_COM_RENT_FIXTURE },
    });
    expect(listing.longTermRent?.monthlyAmount).toBe(500);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
  });

  it('normalizes a for-sale listing', () => {
    const ref: ExternalListingRef = {
      provider: 'realtor_com',
      sourceId: REALTOR_COM_SALE_FIXTURE.property_id,
      url: 'https://www.realtor.com/realestateandhomes-detail/x',
      hints: { kind: 'sale' },
    };
    const listing = provider.normalize({
      ref,
      payload: { sourceId: ref.sourceId, url: ref.url, kind: 'sale', listing: REALTOR_COM_SALE_FIXTURE },
    });
    expect(listing.sale?.price).toBe(385000);
    expect(listing.type).toBe(PropertyType.HOUSE);
  });

  it('discovers refs from GraphQL runtime', async () => {
    const runtime = graphqlRuntime(new Map([['search', JSON.stringify(REALTOR_COM_SEARCH_FIXTURE)]]));
    const testProvider = new RealtorComProvider({ runtime });
    const refs: ExternalListingRef[] = [];
    for await (const ref of testProvider.discover({
      provider: 'realtor_com',
      market: 'US',
      city: 'Austin, TX',
      limit: 2,
      runtime,
    })) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid payload', () => {
    const bad: RawListing = { ref: { provider: 'realtor_com', sourceId: 'x', url: 'https://x' }, payload: 42 };
    expect(() => provider.normalize(bad)).toThrow(/RealtorComRaw/);
  });
});
