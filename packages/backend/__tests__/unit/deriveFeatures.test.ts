/**
 * Amenity → structured feature derivation. Covers both provider vocabularies:
 * raw ES slugs (pisos) and canonical EN keys (fotocasa/habitaclia/IT aliases).
 */

import { deriveStructuredFeatures } from '../../services/ingestion/deriveFeatures';

describe('deriveStructuredFeatures', () => {
  it('returns empty for no amenities', () => {
    expect(deriveStructuredFeatures(undefined)).toEqual({});
    expect(deriveStructuredFeatures([])).toEqual({});
    expect(deriveStructuredFeatures(['soleado', 'exterior', 'reformado'])).toEqual({});
  });

  it('derives from raw ES slugs (pisos vocabulary)', () => {
    expect(
      deriveStructuredFeatures(['ascensor', 'balcon', 'jardin', 'garaje', 'amueblado']),
    ).toEqual({
      hasElevator: true,
      hasBalcony: true,
      hasGarden: true,
      parkingType: 'garage',
      furnishedStatus: 'furnished',
    });
  });

  it('derives from canonical EN keys (fotocasa/habitaclia vocabulary)', () => {
    expect(
      deriveStructuredFeatures(['elevator', 'terrace', 'garden', 'parking', 'furnished']),
    ).toEqual({
      hasElevator: true,
      hasBalcony: true,
      hasGarden: true,
      parkingType: 'garage',
      furnishedStatus: 'furnished',
    });
  });

  it('treats terrace and balcony as the same hasBalcony flag', () => {
    expect(deriveStructuredFeatures(['terraza'])).toEqual({ hasBalcony: true });
    expect(deriveStructuredFeatures(['balcony'])).toEqual({ hasBalcony: true });
    expect(deriveStructuredFeatures(['terrazzo'])).toEqual({ hasBalcony: true });
  });

  it('matches multi-token slugs and phrases without false positives', () => {
    expect(deriveStructuredFeatures(['plaza_de_garaje'])).toEqual({ parkingType: 'garage' });
    expect(deriveStructuredFeatures(['posto_auto'])).toEqual({ parkingType: 'garage' });
    expect(deriveStructuredFeatures(['terraza_20m2'])).toEqual({ hasBalcony: true });
    // 'trastero' (storage) must not trip terrace/garden/parking
    expect(deriveStructuredFeatures(['trastero', 'piscina'])).toEqual({});
  });

  it('normalizes accents and casing before matching', () => {
    expect(deriveStructuredFeatures(['Ascensor', 'JARDÍN', 'Garaje'])).toEqual({
      hasElevator: true,
      hasGarden: true,
      parkingType: 'garage',
    });
  });

  it('only sets fields whose tags are present', () => {
    expect(deriveStructuredFeatures(['ascensor'])).toEqual({ hasElevator: true });
  });
});
