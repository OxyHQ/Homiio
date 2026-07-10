/**
 * Immowelt provider contract test (pure — no live portal).
 */

import {
  ImmoweltProvider,
  IMMOWELT_FIXTURE_CARD_JSON,
  parseImmoweltCard,
  parseImmoweltDetail,
  immoweltSourceIdFromUrl,
} from '@homiio/listing-providers';
import type { RawListing } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new ImmoweltProvider();

describe('ImmoweltProvider', () => {
  it('declares the DE market and immowelt id', () => {
    expect(provider.id).toBe('immowelt');
    expect(provider.markets).toEqual(['DE']);
  });

  it('parses a SERP card JSON into a raw listing with contact', () => {
    const card = JSON.parse(IMMOWELT_FIXTURE_CARD_JSON) as Record<string, unknown>;
    const raw = parseImmoweltCard(card);
    expect(raw.sourceId).toBe('311aaa07-ac4a-477e-ba23-bb35a3754385');
    expect(raw.price).toBe(1659);
    expect(raw.address.city).toBe('Berlin');
    expect(raw.address.street).toBe('Am Maselakepark 8');
    expect(raw.bedrooms).toBe(3);
    expect(raw.squareMeters).toBe(75.4);
    expect(raw.images).toHaveLength(2);
    expect(raw.contact?.agencyName).toMatch(/Stuck Immobilien/);
    expect(raw.contact?.phone).toBe('+49301234567');
    expect(raw.contact?.email).toBe('kontakt@example-immowelt.de');
  });

  it('normalizes a card into a published long-term rental', () => {
    const payload = parseImmoweltDetail(IMMOWELT_FIXTURE_CARD_JSON, 'https://www.immowelt.de/expose/311aaa07-ac4a-477e-ba23-bb35a3754385');
    const listing = provider.normalize({
      ref: { provider: 'immowelt', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('immowelt');
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1659);
    expect(listing.address.countryCode).toBe('DE');
    expect(listing.contact?.agencyName).toBeTruthy();
  });

  it('rejects a non-Immowelt payload', () => {
    const bad: RawListing = {
      ref: { provider: 'immowelt', sourceId: 'x', url: 'https://x' },
      payload: 42,
    };
    expect(() => provider.normalize(bad)).toThrow(/ImmoweltRawListing/);
  });

  it('extracts expose uuids from URLs', () => {
    expect(
      immoweltSourceIdFromUrl('https://www.immowelt.de/expose/311aaa07-ac4a-477e-ba23-bb35a3754385'),
    ).toBe('311aaa07-ac4a-477e-ba23-bb35a3754385');
  });

  it('reports healthy', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('immowelt');
    expect(health.status).toBe('healthy');
  });
});
