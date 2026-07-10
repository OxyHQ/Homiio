/**
 * Fotocasa provider contract test (pure — no DB, no network).
 *
 * Exercises the recorded-fixture → parse → normalize path: the provider turns a
 * Fotocasa detail page's embedded schema.org JSON-LD into a first-party,
 * published, sourced {@link NormalizedListing}, and its search parser yields
 * de-duplicated `…/<id>/d` refs. NO live portal is touched.
 */

import {
  FotocasaProvider,
  isFotocasaChallenge,
  fotocasaSourceIdFromUrl,
  parseFotocasaDetail,
  parseFotocasaSearch,
  FOTOCASA_FIXTURE_DETAIL_HTML,
  FOTOCASA_FIXTURE_SEARCH_HTML,
  FOTOCASA_FIXTURE_REAL_ESTATE_LISTING_HTML,
  FOTOCASA_FIXTURE_NEXT_DATA_HTML,
} from '@homiio/listing-providers';
import type { ExternalListingRef } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new FotocasaProvider();

describe('FotocasaProvider.normalize', () => {
  it('maps a rent detail page into a published long-term-rent listing', () => {
    const payload = parseFotocasaDetail(
      FOTOCASA_FIXTURE_DETAIL_HTML,
      'https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/x/187654321/d',
    );
    const ref: ExternalListingRef = { provider: 'fotocasa', sourceId: payload.sourceId, url: payload.url };
    const listing = provider.normalize({ ref, payload });

    expect(listing.source).toBe('fotocasa');
    expect(listing.sourceId).toBe('187654321');
    expect(listing.sourceUrl).toContain('/187654321/d');
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1850);
    expect(listing.longTermRent?.currency).toBe('EUR');

    expect(listing.address.city).toBe('Madrid');
    expect(listing.address.state).toBe('Madrid');
    expect(listing.address.neighborhood).toBe('Chamberí');
    expect(listing.address.postalCode).toBe('28010');
    expect(listing.address.coordinates).toEqual({ lat: 40.4318, lng: -3.6931 });

    expect(listing.bedrooms).toBe(3);
    expect(listing.bathrooms).toBe(2);
    expect(listing.squareFootage).toBe(95);
    expect(listing.amenities).toEqual(expect.arrayContaining(['elevator', 'heating', 'air_conditioning']));
    expect(listing.remoteImages).toHaveLength(3);
    expect(listing.remoteImages[0].isPrimary).toBe(true);
  });

  it('parses RealEstateListing JSON-LD with a nested about node', () => {
    const payload = parseFotocasaDetail(
      FOTOCASA_FIXTURE_REAL_ESTATE_LISTING_HTML,
      'https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/x/187654321/d',
    );
    expect(payload.sourceId).toBe('187654321');
    expect(payload.listing.price).toBe(1850);
    expect(payload.listing.address.city).toBe('Madrid');
  });

  it('parses listing data from __NEXT_DATA__ when JSON-LD is absent', () => {
    const payload = parseFotocasaDetail(
      FOTOCASA_FIXTURE_NEXT_DATA_HTML,
      'https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/x/187654321/d',
    );
    expect(payload.sourceId).toBe('187654321');
    expect(payload.listing.price).toBe(1850);
    expect(payload.listing.address.city).toBe('Madrid');
  });

  it('throws on a page with no real-estate JSON-LD', () => {
    expect(() => parseFotocasaDetail('<html><body>nope</body></html>', 'https://x/1/d')).toThrow(
      /no real-estate JSON-LD/,
    );
  });
});

describe('FotocasaProvider search + helpers', () => {
  it('parses de-duplicated detail refs from a search page', () => {
    const refs = parseFotocasaSearch(FOTOCASA_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['187654321', '187654322', '187654323']);
    for (const ref of refs) {
      expect(ref.url.startsWith('https://www.fotocasa.es/')).toBe(true);
      expect(ref.url.endsWith('/d')).toBe(true);
    }
  });

  it('extracts a source id from a detail url', () => {
    expect(fotocasaSourceIdFromUrl('https://www.fotocasa.es/es/alquiler/vivienda/x/187654321/d')).toBe(
      '187654321',
    );
  });

  it('flags an anti-bot / tiny body as a challenge', () => {
    expect(isFotocasaChallenge('<html>Verifica que eres una persona</html>')).toBe(true);
    expect(isFotocasaChallenge('tiny')).toBe(true);
    expect(isFotocasaChallenge(FOTOCASA_FIXTURE_DETAIL_HTML)).toBe(false);
  });

  it('reports a health verdict', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('fotocasa');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
  });
});
