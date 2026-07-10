/**
 * Blueground provider contract test (pure — no DB, no live API).
 *
 * Drives the `blueground` plugin from RECORDED JSON fixtures (one EUR Madrid
 * unit, one USD New York unit), asserting `normalize()` maps each onto a
 * published, furnished long-term rental with currency and country carried from
 * the source. No network is touched — CI never hits the live API.
 */

import {
  BluegroundProvider,
  BLUEGROUND_FIXTURES,
  coerceBluegroundListing,
} from '@homiio/listing-providers';
import type { RawListing } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new BluegroundProvider();

function normalizeFixture(index: number) {
  const raw = BLUEGROUND_FIXTURES[index];
  return provider.normalize({
    ref: { provider: 'blueground', sourceId: raw.id, url: raw.url },
    payload: raw,
  });
}

describe('BluegroundProvider', () => {
  it('declares both ES and US markets', () => {
    expect(provider.id).toBe('blueground');
    expect([...provider.markets].sort()).toEqual(['ES', 'US']);
  });

  it('normalizes the Madrid (EUR) fixture as a furnished long-term rental', () => {
    const listing = normalizeFixture(0);
    expect(listing.source).toBe('blueground');
    expect(listing.sourceId).toBe('bg-mad-4471');
    expect(listing.sourceUrl.startsWith('http')).toBe(true);
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(2650);
    expect(listing.longTermRent?.currency).toBe('EUR');
    expect(listing.address.city).toBe('Madrid');
    expect(listing.address.countryCode).toBe('ES');
    expect(listing.address.neighborhood).toBe('Salamanca');
    expect(listing.address.coordinates).toEqual({ lat: 40.4256, lng: -3.6845 });
    expect(listing.furnishedStatus).toBe('furnished');
    expect(listing.remoteImages).toHaveLength(2);
    expect(listing.remoteImages.filter((image) => image.isPrimary)).toHaveLength(1);
  });

  it('normalizes the New York (USD) fixture with US currency and country', () => {
    const listing = normalizeFixture(1);
    expect(listing.sourceId).toBe('bg-nyc-9182');
    expect(listing.longTermRent?.monthlyAmount).toBe(4200);
    expect(listing.longTermRent?.currency).toBe('USD');
    expect(listing.address.city).toBe('New York');
    expect(listing.address.countryCode).toBe('US');
    expect(listing.furnishedStatus).toBe('furnished');
  });

  it('coerces a valid payload and rejects an invalid one', () => {
    expect(coerceBluegroundListing(BLUEGROUND_FIXTURES[0]).id).toBe('bg-mad-4471');
    expect(() => coerceBluegroundListing({ id: 'x' })).toThrow(/BluegroundRawListing/);
  });

  it('rejects a payload that is not a BluegroundRawListing', () => {
    const bad: RawListing = {
      ref: { provider: 'blueground', sourceId: 'x', url: 'https://x' },
      payload: null,
    };
    expect(() => provider.normalize(bad)).toThrow(/BluegroundRawListing/);
  });

  it('reports healthy', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('blueground');
    expect(health.status).toBe('healthy');
  });
});
