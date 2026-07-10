/**
 * Rightmove provider contract test (pure — no DB, no live portal).
 */

import {
  RightmoveProvider,
  parseRightmoveDetail,
  parseRightmoveSearchJson,
  parseRightmoveTypeahead,
  RIGHTMOVE_FIXTURE_DETAIL_HTML,
  RIGHTMOVE_FIXTURE_SEARCH_HTML,
  RIGHTMOVE_FIXTURE_TYPEAHEAD_JSON,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new RightmoveProvider();

describe('RightmoveProvider', () => {
  it('declares the GB market', () => {
    expect(provider.id).toBe('rightmove');
    expect(provider.markets).toEqual(['GB']);
  });

  it('parses typeahead JSON into a locationIdentifier', () => {
    expect(parseRightmoveTypeahead(RIGHTMOVE_FIXTURE_TYPEAHEAD_JSON)).toBe('REGION^87490');
  });

  it('parses housing search cards and skips garages', () => {
    const refs = parseRightmoveSearchJson(RIGHTMOVE_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['90551949', '90551951']);
    expect(refs.every((ref) => ref.kind === 'rent')).toBe(true);
  });

  it('normalizes a detail PAGE_MODEL into a published GBP rental with contact', () => {
    const payload = parseRightmoveDetail(
      RIGHTMOVE_FIXTURE_DETAIL_HTML,
      'https://www.rightmove.co.uk/properties/90551949',
    );
    const listing = provider.normalize({
      ref: { provider: 'rightmove', sourceId: payload.sourceId, url: payload.url },
      payload,
    });

    expect(listing.source).toBe('rightmove');
    expect(listing.sourceId).toBe('90551949');
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(3400);
    expect(listing.longTermRent?.currency).toBe('GBP');
    expect(listing.address.countryCode).toBe('GB');
    expect(listing.address.city).toContain('London');
    expect(listing.bedrooms).toBe(1);
    expect(listing.remoteImages.length).toBeGreaterThan(0);
    expect(listing.contact?.phone).toContain('020');
    expect(listing.contact?.agencyName).toMatch(/Savills/i);
    expect('images' in listing).toBe(false);
  });
});
