/**
 * HotPads provider contract test (pure — no DB, no live portal).
 */

import {
  HotpadsProvider,
  HOTPADS_AREA_FIXTURE,
  HOTPADS_LISTING_FIXTURE,
  HOTPADS_SEARCH_FIXTURE,
  parseHotpadsSearch,
} from '@homiio/listing-providers';
import type { ExternalListingRef, RawListing } from '@homiio/listing-providers';
import { OfferingType } from '@homiio/shared-types';

const provider = new HotpadsProvider();

describe('HotpadsProvider', () => {
  it('parses search JSON into listing refs', () => {
    const refs = parseHotpadsSearch(JSON.stringify(HOTPADS_SEARCH_FIXTURE));
    expect(refs[0]?.sourceId).toBe(HOTPADS_LISTING_FIXTURE.aliasEncoded);
  });

  it('normalizes fixture into long-term rental', () => {
    const ref: ExternalListingRef = {
      provider: 'hotpads',
      sourceId: HOTPADS_LISTING_FIXTURE.aliasEncoded,
      url: 'https://hotpads.com/example/pad',
    };
    const listing = provider.normalize({
      ref,
      payload: { sourceId: ref.sourceId, url: ref.url, listing: HOTPADS_LISTING_FIXTURE },
    });
    expect(listing.longTermRent?.monthlyAmount).toBe(1728);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.address.city).toBe('Austin');
  });

  it('rejects invalid payload', () => {
    const bad: RawListing = { ref: { provider: 'hotpads', sourceId: 'x', url: 'https://x' }, payload: null };
    expect(() => provider.normalize(bad)).toThrow(/HotpadsRaw/);
  });
});
