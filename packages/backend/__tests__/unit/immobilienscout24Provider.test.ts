/**
 * ImmobilienScout24 provider — mobile JSON fixture → normalize (pure).
 */

import {
  ImmobilienScout24Provider,
  parseIs24Search,
  parseIs24Expose,
  is24SourceIdFromUrl,
  is24PublicUrl,
  IS24_FIXTURE_SEARCH_JSON,
  IS24_FIXTURE_EXPOSE_JSON,
  IS24_FIXTURE_EXPOSE_REAL_JSON,
} from '@homiio/listing-providers';
import type { ExternalListingRef } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new ImmobilienScout24Provider();

describe('ImmobilienScout24Provider', () => {
  it('parses search list refs from mobile JSON', () => {
    const refs = parseIs24Search(IS24_FIXTURE_SEARCH_JSON);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['160012345', '160067890']);
    expect(refs[0]?.url).toContain('/expose/');
  });

  it('normalizes expose JSON into a published DE rent listing with contact', () => {
    const payload = parseIs24Expose(IS24_FIXTURE_EXPOSE_JSON);
    const ref: ExternalListingRef = {
      provider: 'immobilienscout24',
      sourceId: payload.sourceId,
      url: payload.url,
    };
    const listing = provider.normalize({ ref, payload });
    expect(listing.source).toBe('immobilienscout24');
    expect(listing.sourceId).toBe('160012345');
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1250);
    expect(listing.address.countryCode).toBe('DE');
    expect(listing.address.city).toMatch(/Berlin/i);
    expect(listing.bedrooms).toBe(2);
    expect(listing.squareFootage).toBe(65);
    expect(listing.remoteImages.length).toBe(2);
    expect(listing.contact?.phone).toMatch(/493012345678/);
    expect(listing.contact?.agencyName).toMatch(/Mitte Homes/i);
    // Description comes from the 'Objektbeschreibung' TEXT_AREA block (the real
    // mobile expose shape), not the 'Lage' block that precedes it.
    expect(listing.description).toMatch(/Balkon/i);
    expect(listing.description).not.toMatch(/Rosenthaler Platz/i);
  });

  it('derives source id and public URL helpers', () => {
    expect(is24SourceIdFromUrl(is24PublicUrl('160012345'))).toBe('160012345');
  });

  it('extracts floor/bathrooms/yearBuilt + amenities from the real ATTRIBUTE_LIST + CHECK shape', () => {
    const payload = parseIs24Expose(IS24_FIXTURE_EXPOSE_REAL_JSON);
    const ref: ExternalListingRef = {
      provider: 'immobilienscout24',
      sourceId: payload.sourceId,
      url: payload.url,
    };
    const listing = provider.normalize({ ref, payload });
    expect(listing.sourceId).toBe('169270319');
    expect(listing.longTermRent?.monthlyAmount).toBe(380);
    expect(listing.bedrooms).toBe(1);
    // Structured fields that were 0% before (Etage "2 von 4", Badezimmer, Baujahr).
    expect(listing.floor).toBe(2);
    expect(listing.bathrooms).toBe(1);
    expect(listing.yearBuilt).toBe(2026);
    // Amenities from CHECK feature flags + Heizungsart; combined `Balkon/Terrasse`
    // splits into both features.
    expect((listing.amenities ?? []).length).toBeGreaterThan(0);
    expect(listing.amenities).toEqual(
      expect.arrayContaining(['elevator', 'balcony', 'terrace', 'storage', 'garden', 'parking', 'heating']),
    );
    expect(listing.address.city).toMatch(/Berlin/i);
  });
});
