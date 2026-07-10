/**
 * Fixture provider contract test (pure — no DB).
 *
 * Exercises the Phase-0 `fixture` provider end to end at the provider layer:
 * discover yields refs, fetch returns the raw payload, normalize maps it to a
 * provider-agnostic `NormalizedListing`. This is the upstream half of the
 * fixture -> ingest path; the ingest half lives in
 * `integration/externalIngest.test.ts`.
 */

import { FixtureProvider, FIXTURE_LISTINGS, createFetchRuntime } from '@homiio/listing-providers';
import type { ExternalListingRef, FetchContext, RawListing } from '@homiio/listing-providers';
import { OfferingType, PropertyType, type NormalizedListing } from '@homiio/shared-types';

const provider = new FixtureProvider();
const ctx: FetchContext = { runtime: createFetchRuntime() };

async function discoverRefs(limit?: number): Promise<ExternalListingRef[]> {
  const refs: ExternalListingRef[] = [];
  for await (const ref of provider.discover({ provider: 'fixture', market: 'ES', limit })) {
    refs.push(ref);
  }
  return refs;
}

async function normalizeAll(): Promise<NormalizedListing[]> {
  const listings: NormalizedListing[] = [];
  for (const ref of await discoverRefs()) {
    const raw = await provider.fetch(ref, ctx);
    listings.push(provider.normalize(raw));
  }
  return listings;
}

describe('FixtureProvider', () => {
  it('discovers every bundled fixture as a well-formed ref', async () => {
    const refs = await discoverRefs();
    expect(refs).toHaveLength(FIXTURE_LISTINGS.length);
    for (const ref of refs) {
      expect(ref.provider).toBe('fixture');
      expect(typeof ref.sourceId).toBe('string');
      expect(ref.url.startsWith('http')).toBe(true);
    }
  });

  it('honours the discover limit', async () => {
    const refs = await discoverRefs(1);
    expect(refs).toHaveLength(1);
  });

  it('fetch resolves the raw payload for a discovered ref', async () => {
    const [ref] = await discoverRefs(1);
    const raw = await provider.fetch(ref, ctx);
    expect(raw.ref).toEqual(ref);
    expect(raw.payload).toBeTruthy();
  });

  it('fetch rejects an unknown sourceId', async () => {
    await expect(
      provider.fetch({ provider: 'fixture', sourceId: 'does-not-exist', url: 'https://x' }, ctx),
    ).rejects.toThrow(/no listing/i);
  });

  it('normalizes fixtures into published, sourced, self-describing listings', async () => {
    const listings = await normalizeAll();
    expect(listings).toHaveLength(FIXTURE_LISTINGS.length);

    const first = listings[0];
    expect(first.source).toBe('fixture');
    expect(first.sourceId).toBe('fixture-bcn-0001');
    expect(first.sourceUrl.startsWith('http')).toBe(true);
    expect(first.status).toBe('published');
    expect(first.type).toBe(PropertyType.APARTMENT);
    expect(first.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(first.longTermRent?.monthlyAmount).toBe(1450);
    expect(first.longTermRent?.currency).toBe('EUR');
    expect(first.address.city).toBe('Barcelona');
    expect(first.address.state).toBe('Catalonia');
    expect(first.address.countryCode).toBe('ES');
    expect(first.address.coordinates).toBeDefined();
    expect(first.remoteImages.length).toBeGreaterThan(0);
    expect(first.remoteImages.filter((image) => image.isPrimary)).toHaveLength(1);
  });

  it('rejects a payload that is not a fixture listing', () => {
    const bad: RawListing = {
      ref: { provider: 'fixture', sourceId: 'x', url: 'https://x' },
      payload: 42,
    };
    expect(() => provider.normalize(bad)).toThrow(/FixtureRawListing/);
  });

  it('reports healthy while it has fixtures', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('fixture');
    expect(health.status).toBe('healthy');
  });
});
