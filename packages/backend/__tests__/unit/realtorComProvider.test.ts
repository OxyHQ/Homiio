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
    async fetchHttp(url: string, init?: { body?: string }): Promise<{ status: number; body: string }> {
      if (responses.has(url)) {
        return { status: 200, body: responses.get(url) ?? '' };
      }
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
  it('declares the US market and realtor_com id', () => {
    expect(provider.id).toBe('realtor_com');
    expect(provider.markets).toEqual(['US']);
  });

  it('parses search GraphQL into refs with rent/sale kinds', () => {
    const refs = parseRealtorSearchResponse(JSON.stringify(REALTOR_COM_SEARCH_FIXTURE));
    expect(refs.map((ref) => ref.sourceId)).toEqual([
      REALTOR_COM_RENT_FIXTURE.property_id,
      REALTOR_COM_SALE_FIXTURE.property_id,
    ]);
    expect(refs[0]?.kind).toBe('rent');
    expect(refs[1]?.kind).toBe('sale');
  });

  it('discovers refs from a GraphQL-backed runtime', async () => {
    const runtime = graphqlRuntime(
      new Map([['search', JSON.stringify(REALTOR_COM_SEARCH_FIXTURE)]]),
    );
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

  it('normalizes a for-rent listing using list_price_min', () => {
    const ref: ExternalListingRef = {
      provider: 'realtor_com',
      sourceId: REALTOR_COM_RENT_FIXTURE.property_id,
      url: 'https://www.realtor.com/realestateandhomes-detail/x',
      hints: { kind: 'rent' },
    };
    const listing = provider.normalize({
      ref,
      payload: {
        sourceId: ref.sourceId,
        url: ref.url,
        kind: 'rent',
        listing: REALTOR_COM_RENT_FIXTURE,
      },
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(500);
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.address.city).toBe('Austin');
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
      payload: {
        sourceId: ref.sourceId,
        url: ref.url,
        kind: 'sale',
        listing: REALTOR_COM_SALE_FIXTURE,
      },
    });
    expect(listing.offerings).toEqual([OfferingType.SALE]);
    expect(listing.sale?.price).toBe(385000);
    expect(listing.type).toBe(PropertyType.HOUSE);
  });

  it('fetch pulls detail via HomeDetails GraphQL', async () => {
    const runtime = graphqlRuntime(
      new Map([['detail', JSON.stringify({ data: { home: REALTOR_COM_RENT_FIXTURE } })]]),
    );
    const testProvider = new RealtorComProvider({ runtime });
    const ref: ExternalListingRef = {
      provider: 'realtor_com',
      sourceId: REALTOR_COM_RENT_FIXTURE.property_id,
      url: 'https://www.realtor.com/realestateandhomes-detail/x',
    };
    const raw = await testProvider.fetch(ref, { runtime });
    const payload = raw.payload as { listing: { property_id: string } };
    expect(payload.listing.property_id).toBe(REALTOR_COM_RENT_FIXTURE.property_id);
  });

  it('rejects a payload that is not a RealtorComRaw', () => {
    const bad: RawListing = {
      ref: { provider: 'realtor_com', sourceId: 'x', url: 'https://x' },
      payload: 42,
    };
    expect(() => provider.normalize(bad)).toThrow(/RealtorComRaw/);
  });
});
