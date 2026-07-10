/**
 * Derive structured Property feature fields from a listing's free-form
 * `amenities` list.
 *
 * Providers already parse portal feature tags (ascensor, terraza, garaje, …)
 * but only ever store them as amenity strings — the structured Property columns
 * the search filters and UI read (`hasElevator`, `hasBalcony`, `hasGarden`,
 * `parkingType`, `furnishedStatus`) stay at their defaults. This is the single
 * ingest chokepoint that promotes those tags to the structured fields, so every
 * provider benefits without per-provider parsing.
 *
 * Two vocabularies coexist and are both handled:
 * - raw ES slugs from pisos (`ascensor`, `balcon`, `terraza`, `garaje`, …)
 * - canonical EN keys from fotocasa/habitaclia/IT aliases (`elevator`,
 *   `terrace`, `balcony`, `parking`, `garden`, `furnished`).
 *
 * A provider that sets a structured field explicitly (e.g. immoweb `hasLift`)
 * always wins — this only fills the gaps.
 */

/** Structured feature fields derivable from amenity tags. */
export interface DerivedFeatures {
  hasElevator?: boolean;
  hasBalcony?: boolean;
  hasGarden?: boolean;
  parkingType?: 'garage';
  furnishedStatus?: 'furnished';
}

/** Single-token keywords (deaccented, lowercased) that activate each feature. */
const KEYWORDS = {
  elevator: ['elevator', 'ascensor', 'ascensore', 'ascenseur', 'lift'],
  balcony: [
    'balcony',
    'balcon',
    'balcone',
    'terrace',
    'terraza',
    'terrazza',
    'terrazzo',
    'terrasse',
  ],
  garden: ['garden', 'jardin', 'giardino', 'jardim'],
  parking: ['parking', 'garaje', 'garage', 'parcheggio', 'estacionamiento', 'cochera'],
  furnished: ['furnished', 'amueblado', 'amoblado', 'arredato', 'arredata', 'meuble', 'meublee'],
} as const;

/** Multi-token phrases (already normalized with `_` separators). */
const PHRASES = {
  parking: ['posto_auto', 'plaza_de_garaje', 'plaza_garaje', 'parking_space'],
} as const;

/** Match pisos' amenity normalization so both vocabularies compare equal. */
function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * True when any amenity token equals a keyword, contains one as an underscore
 * sub-token (`plaza_de_garaje` → `garaje`), or equals a known phrase.
 */
function hasFeature(
  tokens: readonly string[],
  keywords: readonly string[],
  phrases: readonly string[] = [],
): boolean {
  const keywordSet = new Set(keywords);
  const phraseSet = new Set(phrases);
  for (const token of tokens) {
    if (phraseSet.has(token)) return true;
    if (keywordSet.has(token)) return true;
    for (const part of token.split('_')) {
      if (keywordSet.has(part)) return true;
    }
  }
  return false;
}

/**
 * Promote amenity tags to structured feature fields. Only sets a field when the
 * corresponding tag is present — absent tags are left undefined so the caller
 * keeps provider-explicit values and schema defaults.
 */
export function deriveStructuredFeatures(amenities: readonly string[] | undefined): DerivedFeatures {
  if (!amenities || amenities.length === 0) return {};
  const tokens = amenities.map(normalizeToken).filter(Boolean);
  if (tokens.length === 0) return {};

  const features: DerivedFeatures = {};
  if (hasFeature(tokens, KEYWORDS.elevator)) features.hasElevator = true;
  if (hasFeature(tokens, KEYWORDS.balcony)) features.hasBalcony = true;
  if (hasFeature(tokens, KEYWORDS.garden)) features.hasGarden = true;
  if (hasFeature(tokens, KEYWORDS.parking, PHRASES.parking)) features.parkingType = 'garage';
  if (hasFeature(tokens, KEYWORDS.furnished)) features.furnishedStatus = 'furnished';
  return features;
}
