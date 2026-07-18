/**
 * Canonical amenity vocabulary — the single source of truth every provider maps
 * onto. These tests lock the contract: different portal dialects (localized
 * ES/IT labels, English feature slugs, camelCase keys, boolean-flag targets, raw
 * slugs, free-text marketing copy) all collapse onto the SAME fixed canonical
 * key, non-amenities are dropped, and `furnished` is hoisted out of the list.
 */

import {
  CANONICAL_AMENITIES,
  canonicalAmenity,
  canonicalizeAmenities,
  isCanonicalAmenity,
  slugifyAmenityToken,
} from '@homiio/listing-providers';

describe('canonicalAmenity', () => {
  it('maps every portal dialect for the same amenity to one canonical key', () => {
    // elevator: ES / IT / EN feature slug / camelCase (blueground) / free text
    for (const input of ['ascensor', 'ascensore', 'Lift', 'elevatorInTheBuilding', 'elevator']) {
      expect(canonicalAmenity(input)).toBe('elevator');
    }
    // parking: ES slug / IT / EN / camelCase / free-text marketing copy
    for (const input of ['garaje', 'posto_auto', 'garage', 'parkingSpace', 'Off street parking']) {
      expect(canonicalAmenity(input)).toBe('parking');
    }
    // pool
    for (const input of ['piscina', 'swimming_pool', 'community_pool']) {
      expect(canonicalAmenity(input)).toBe('pool');
    }
    // air conditioning (localized + EN + camelCase)
    for (const input of ['aire acondicionado', 'aria condizionata', 'air_conditioner', 'airConditioning']) {
      expect(canonicalAmenity(input)).toBe('air_conditioning');
    }
    // washing machine (blueground washerUnit / laundryRoomUnit / raw washer)
    for (const input of ['washer', 'washerUnit', 'laundryRoomUnit', 'lavadora']) {
      expect(canonicalAmenity(input)).toBe('washing_machine');
    }
    // connectivity: immoweb `internet` and search `wifi` unify
    for (const input of ['internet', 'wifi', 'wi-fi']) {
      expect(canonicalAmenity(input)).toBe('wifi');
    }
    // terrace (ES/IT) and intercom (immoweb visiophone)
    expect(canonicalAmenity('terraza')).toBe('terrace');
    expect(canonicalAmenity('terrazzo')).toBe('terrace');
    expect(canonicalAmenity('visiophone')).toBe('intercom');
  });

  it('hoists furnished tokens to the sentinel, never an amenity', () => {
    for (const input of ['amueblado', 'arredato', 'furnished', 'meublee']) {
      expect(canonicalAmenity(input)).toBe('furnished');
    }
  });

  it('drops non-amenity words (condition, orientation, marketing copy)', () => {
    for (const input of ['soleado', 'exterior', 'reformado', 'Double glazing', 'coffeeMachine', '']) {
      expect(canonicalAmenity(input)).toBeUndefined();
    }
  });

  it('only ever resolves to a key in the fixed canonical set', () => {
    for (const key of CANONICAL_AMENITIES) {
      expect(isCanonicalAmenity(key)).toBe(true);
    }
    expect(isCanonicalAmenity('coffee_machine')).toBe(false);
  });
});

describe('slugifyAmenityToken', () => {
  it('deaccents, splits camelCase, and snake-cases', () => {
    expect(slugifyAmenityToken('airConditioning')).toBe('air_conditioning');
    expect(slugifyAmenityToken('Aire Acondicionado')).toBe('aire_acondicionado');
    expect(slugifyAmenityToken('Off street parking')).toBe('off_street_parking');
  });
});

describe('canonicalizeAmenities', () => {
  it('canonicalizes, dedupes, and hoists furnished out of the list', () => {
    const result = canonicalizeAmenities([
      'ascensor', // elevator
      'Lift', // elevator (dedupe)
      'piscina', // pool
      'amueblado', // furnished → hoisted
      'soleado', // dropped
      'garaje', // parking
    ]);
    expect(result.amenities).toEqual(['elevator', 'pool', 'parking']);
    expect(result.furnished).toBe(true);
  });

  it('omits furnished when no furnished token is present', () => {
    expect(canonicalizeAmenities(['piscina', 'jardin'])).toEqual({
      amenities: ['pool', 'garden'],
    });
  });

  // MercadoLibre AR/MX use es-419 vocabulary that differs from the peninsular
  // Spanish already covered (`garaje`, `piscina`, `trastero`). Without these the
  // LatAm spec tables canonicalized to nothing and the amenities were dropped.
  it('canonicalizes es-419 (LatAm) vocabulary onto the same keys as es-ES', () => {
    expect(canonicalizeAmenities(['Cocheras']).amenities).toEqual(['parking']);
    expect(canonicalizeAmenities(['Estacionamientos']).amenities).toEqual(['parking']);
    expect(canonicalizeAmenities(['Alberca']).amenities).toEqual(['pool']);
    expect(canonicalizeAmenities(['Bauleras']).amenities).toEqual(['storage']);
    expect(canonicalizeAmenities(['Bodegas']).amenities).toEqual(['storage']);
    expect(canonicalizeAmenities(['Con lavandería']).amenities).toEqual(['laundry_room']);

    // Regional synonyms must collapse onto ONE key, not duplicate it.
    expect(canonicalizeAmenities(['cochera', 'estacionamiento', 'garaje']).amenities).toEqual([
      'parking',
    ]);
    expect(canonicalizeAmenities(['alberca', 'piscina']).amenities).toEqual(['pool']);
    expect(canonicalizeAmenities(['baulera', 'bodega', 'trastero']).amenities).toEqual(['storage']);
  });
});
