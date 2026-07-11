/**
 * Canonical amenity vocabulary — ONE source of truth for every provider.
 *
 * Portals speak wildly different amenity dialects: localized labels
 * (`ascensor`, `ascensore`, `aria condizionata`), internal English feature
 * slugs (`air_conditioner`, `storage_room`), camelCase keys
 * (`elevatorInTheBuilding`, `parkingSpace`), boolean flag names (`hasLift`) and
 * free-form marketing copy (`Off street parking`). Left unmapped, the same
 * amenity would be stored under a dozen different keys, breaking cross-portal
 * search (`amenities: { $in }`) and forcing the app to render raw slugs.
 *
 * This module collapses ALL of those inputs onto a single fixed, documented set
 * of canonical EN snake_case keys. Every provider (and the ingest chokepoint in
 * {@link ./listing.ts sanitizeNormalizedListingTextFields}) canonicalizes
 * through {@link canonicalAmenity} / {@link canonicalizeAmenities} — there are
 * NO per-portal alias tables anymore. The frontend has a matching translation
 * for each canonical key, so structured amenities always render localized.
 */

/**
 * The fixed, documented canonical amenity vocabulary (EN snake_case). Every key
 * here has a frontend translation under `amenities.*`. Anything a provider emits
 * that does not resolve to one of these (or {@link FURNISHED_TOKEN}) is dropped
 * rather than stored as an untranslatable slug.
 *
 * Keep this in sync with the frontend catalog aliases in
 * `packages/frontend/constants/amenities.tsx` (`CANONICAL_AMENITY_TO_CATALOG_ID`).
 */
export const CANONICAL_AMENITIES = [
  'air_conditioning',
  'heating',
  'elevator',
  'balcony',
  'terrace',
  'garden',
  'parking',
  'pool',
  'storage',
  'wifi',
  'cable_tv',
  'dishwasher',
  'washing_machine',
  'dryer',
  'laundry_room',
  'gym',
  'sauna',
  'jacuzzi',
  'intercom',
  'armored_door',
  'attic',
  'disabled_access',
] as const;

export type CanonicalAmenity = (typeof CANONICAL_AMENITIES)[number];

/**
 * Special sentinel: `furnished` is a first-class structured field
 * (`furnishedStatus`), never stored as an amenity tag. Providers/ingest hoist it
 * out of the amenity list — see {@link canonicalizeAmenities}.
 */
export const FURNISHED_TOKEN = 'furnished';

const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_AMENITIES);

/**
 * Normalize an arbitrary amenity token/label to a comparable slug: strip
 * accents, split camelCase (`airConditioning` → `air_conditioning`), lowercase,
 * and collapse every non-alphanumeric run to a single `_`.
 */
export function slugifyAmenityToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Every recognized input slug → canonical key (or {@link FURNISHED_TOKEN}).
 * Inputs are already {@link slugifyAmenityToken}-normalized. Covers Spanish and
 * Italian localized labels, English portal feature slugs, camelCase/boolean-flag
 * derived slugs and common free-text phrases. Keys not present here fall back to
 * a direct canonical-set membership check in {@link canonicalAmenity}.
 */
const AMENITY_ALIASES: Readonly<Record<string, CanonicalAmenity | typeof FURNISHED_TOKEN>> = {
  // elevator
  ascensor: 'elevator',
  ascensore: 'elevator',
  ascenseur: 'elevator',
  lift: 'elevator',
  elevator_in_the_building: 'elevator',
  // air conditioning
  aire_acondicionado: 'air_conditioning',
  climatizacion: 'air_conditioning',
  aria_condizionata: 'air_conditioning',
  climatizzazione: 'air_conditioning',
  air_conditioner: 'air_conditioning',
  air_conditioned: 'air_conditioning',
  // heating
  calefaccion: 'heating',
  riscaldamento: 'heating',
  central_heating: 'heating',
  gas_central_heating: 'heating',
  // terrace
  terraza: 'terrace',
  terrazzo: 'terrace',
  terrazza: 'terrace',
  terrace_private: 'terrace',
  // balcony
  balcon: 'balcony',
  balcone: 'balcony',
  // parking
  garaje: 'parking',
  garage: 'parking',
  parcheggio: 'parking',
  posto_auto: 'parking',
  parking_space: 'parking',
  plaza_de_garaje: 'parking',
  plaza_garaje: 'parking',
  off_street_parking: 'parking',
  // pool
  piscina: 'pool',
  swimming_pool: 'pool',
  community_pool: 'pool',
  private_pool: 'pool',
  // garden
  jardin: 'garden',
  giardino: 'garden',
  jardim: 'garden',
  private_garden: 'garden',
  communal_garden: 'garden',
  // storage
  trastero: 'storage',
  cantina: 'storage',
  storage_room: 'storage',
  basement: 'storage',
  // washing machine / laundry
  lavadora: 'washing_machine',
  lavatrice: 'washing_machine',
  washer: 'washing_machine',
  washer_unit: 'washing_machine',
  laundry_room_unit: 'washing_machine',
  laundry: 'laundry_room',
  // dryer / dishwasher
  secadora: 'dryer',
  tumble_dryer: 'dryer',
  lavavajillas: 'dishwasher',
  lavastoviglie: 'dishwasher',
  dish_washer: 'dishwasher',
  // gym / wellness
  gimnasio: 'gym',
  fitness_room: 'gym',
  fitness: 'gym',
  hot_tub: 'jacuzzi',
  // connectivity
  internet: 'wifi',
  wi_fi: 'wifi',
  fiber: 'wifi',
  // intercom / security
  portero: 'intercom',
  portero_automatico: 'intercom',
  visiophone: 'intercom',
  video_intercom: 'intercom',
  puerta_blindada: 'armored_door',
  buhardilla: 'attic',
  acceso_minusvalidos: 'disabled_access',
  wheelchair_access: 'disabled_access',
  disabled_access: 'disabled_access',
  // furnished (hoisted into furnishedStatus, never stored as an amenity)
  amueblado: FURNISHED_TOKEN,
  amoblado: FURNISHED_TOKEN,
  arredato: FURNISHED_TOKEN,
  arredata: FURNISHED_TOKEN,
  meuble: FURNISHED_TOKEN,
  meublee: FURNISHED_TOKEN,
  furnished: FURNISHED_TOKEN,
};

/**
 * Resolve any portal amenity token/label to its canonical key,
 * {@link FURNISHED_TOKEN}, or `undefined` when it is not a recognized amenity
 * (dimensions, condition, orientation, marketing fluff, …). Never falls back to
 * a raw slug — unrecognized inputs are intentionally dropped so only the fixed,
 * translatable vocabulary is ever stored.
 */
export function canonicalAmenity(
  input: string,
): CanonicalAmenity | typeof FURNISHED_TOKEN | undefined {
  const slug = slugifyAmenityToken(input);
  if (!slug) return undefined;
  const aliased = AMENITY_ALIASES[slug];
  if (aliased) return aliased;
  if (CANONICAL_SET.has(slug)) return slug as CanonicalAmenity;
  return undefined;
}

/** Whether a slug is one of the fixed canonical amenity keys. */
export function isCanonicalAmenity(slug: string): slug is CanonicalAmenity {
  return CANONICAL_SET.has(slug);
}

export interface CanonicalizeAmenitiesResult {
  /** Deduped canonical amenity keys, in first-seen order. */
  amenities: string[];
  /** `true` when a `furnished` token was seen (hoist into `furnishedStatus`). */
  furnished?: boolean;
}

/**
 * Canonicalize a list of raw amenity tokens/labels: map each through
 * {@link canonicalAmenity}, drop unrecognized entries, dedupe, and hoist any
 * `furnished` token into the returned {@link CanonicalizeAmenitiesResult.furnished}
 * flag instead of the amenity list.
 */
export function canonicalizeAmenities(
  inputs: Iterable<string>,
): CanonicalizeAmenitiesResult {
  const seen = new Set<string>();
  const amenities: string[] = [];
  let furnished: boolean | undefined;
  for (const input of inputs) {
    const canonical = canonicalAmenity(input);
    if (!canonical) continue;
    if (canonical === FURNISHED_TOKEN) {
      furnished = true;
      continue;
    }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      amenities.push(canonical);
    }
  }
  return furnished === undefined ? { amenities } : { amenities, furnished };
}
