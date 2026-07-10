/**
 * ImmobilienScout24 provider contract test (pure — no live portal).
 */

import {
  ImmobilienScout24Provider,
  IS24_FIXTURE_EXPOSE_JSON,
  IS24_FIXTURE_SEARCH_JSON,
  parseIs24Expose,
  parseIs24Search,
  is24SourceIdFromUrl,
} from '@homiio/listing-providers';
import type { RawListing } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new ImmobilienScout24Provider();

describe('ImmobilienScout24Provider', () => {
  it('declares the DE market and immobilienscout24 id', () => {
    expect(provider.id).toBe('immobilienscout24');
    expect(provider.markets).toEqual(['DE']);
  });

  it('parses mobile search-list JSON into de-duplicated refs', () => {
    const refs = parseIs24Search(IS24_FIXTURE_SEARCH_JSON);
    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => ref.sourceId)).toEqual(['160012345', '160067890']);
    for (const ref of refs) {
      expect(ref.url).toBe(`https://www.immobilienscout24.de/expose/${ref.sourceId}`);
    }
  });

  it('parses expose JSON with price, address, images, and contact', () => {
    const raw = parseIs24Expose(IS24_FIXTURE_EXPOSE_JSON);
    expect(raw.sourceId).toBe('160012345');
    expect(raw.operation).toBe('rent');
    expect(raw.price).toBe(1250);
    expect(raw.currency).toBe('EUR');
    expect(raw.address.city).toBe('Berlin');
    expect(raw.address.neighborhood).toBe('Mitte');
    expect(raw.address.street).toBe('Torstrasse 1');
    expect(raw.bedrooms).toBe(2);
    expect(raw.squareMeters).toBe(65);
    expect(raw.images).toHaveLength(2);
    expect(raw.contact?.phone).toBe('+493012345678');
    expect(raw.contact?.agencyName).toBe('Mitte Homes GmbH');
  });

  it('normalizes a recorded expose into a published long-term rental', () => {
    const payload = parseIs24Expose(IS24_FIXTURE_EXPOSE_JSON);
    const listing = provider.normalize({
      ref: { provider: 'immobilienscout24', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('immobilienscout24');
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1250);
    expect(listing.longTermRent?.currency).toBe('EUR');
    expect(listing.address.countryCode).toBe('DE');
    expect(listing.contact?.agencyName).toBe('Mitte Homes GmbH');
    expect(listing.remoteImages).toHaveLength(2);
  });

  it('rejects a non-Is24 payload', () => {
    const bad: RawListing = {
      ref: { provider: 'immobilienscout24', sourceId: 'x', url: 'https://x' },
      payload: 42,
    };
    expect(() => provider.normalize(bad)).toThrow(/Is24RawListing/);
  });

  it('extracts source ids from public expose URLs', () => {
    expect(is24SourceIdFromUrl('https://www.immobilienscout24.de/expose/160012345')).toBe('160012345');
  });

  it('reports healthy', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('immobilienscout24');
    expect(health.status).toBe('healthy');
  });
});
