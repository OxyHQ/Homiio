/**
 * Bloom's housing features, resolved against what Homiio actually records
 * (#518 §6, #519 §6.1).
 *
 * Bloom's `FeatureFilter` offers eleven chips. Homiio can answer all eleven —
 * and that is exactly why this file exists, because several of them are
 * recorded in TWO places and the two do not agree.
 *
 * ## The duplication, and which side wins
 *
 * A garden is `properties.has_garden`, and it is also the amenity slugs
 * `garden_space` and `garden_access`. A lift is `has_elevator` and the slug
 * `elevator`. Parking, pets and furnishing are the same story. Picking one
 * silently is the kind of choice that makes a filter wrong in a way nobody
 * notices, so it is made here, once, with a reason:
 *
 * **A COLUMN wins wherever there is one.** A boolean column is present on every
 * row — an unset one is a real `false`. An amenity slug is free text a listing
 * carries or does not, and an ingest that never emitted `garden_space` leaves a
 * home with a garden looking like a home without one. Filtering on the slug
 * would quietly exclude it.
 *
 * The five with no column stay on their slug, which is the same bargain the
 * amenity filter already makes everywhere else: an unknown slug matches
 * nothing, which is the correct answer to "which homes SAID they have a pool".
 */

/** The eleven, in Bloom's own order. */
export const HOUSING_FEATURES = [
  'elevator',
  'parking',
  'terrace',
  'garden',
  'pool',
  'furnished',
  'pets',
  'airConditioning',
  'heating',
  'accessible',
  'storage',
] as const;
export type HousingFeature = (typeof HOUSING_FEATURES)[number];

/**
 * How one feature is answered.
 *
 *  - `column` — a structured field on `properties`. The backend owns the
 *    predicate; the name here is documentation, not SQL.
 *  - `amenity` — a slug that must appear in the listing's `amenities`.
 */
export type HousingFeatureSource =
  | { readonly kind: 'column'; readonly column: string }
  | { readonly kind: 'amenity'; readonly slug: string };

/**
 * The mapping, total over {@link HOUSING_FEATURES}.
 *
 * Read by the backend to build predicates and by nothing on the client, which
 * only needs the chip list — but it lives in the shared contract so the two
 * cannot come to disagree about what "garden" means.
 */
export const HOUSING_FEATURE_SOURCE: Readonly<Record<HousingFeature, HousingFeatureSource>> = {
  elevator: { kind: 'column', column: 'has_elevator' },
  parking: { kind: 'column', column: 'parking_type' },
  garden: { kind: 'column', column: 'has_garden' },
  furnished: { kind: 'column', column: 'furnished_status' },
  pets: { kind: 'column', column: 'pet_friendly' },
  // No column for any of these. `has_balcony` is NOT a terrace — a balcony is a
  // ledge and a terrace is a floor you can put a table on, and Homiio's own
  // amenity catalogue lists them as two different things.
  terrace: { kind: 'amenity', slug: 'terrace' },
  pool: { kind: 'amenity', slug: 'swimming_pool' },
  airConditioning: { kind: 'amenity', slug: 'air_conditioning' },
  heating: { kind: 'amenity', slug: 'heating' },
  accessible: { kind: 'amenity', slug: 'wheelchair_accessible' },
  storage: { kind: 'amenity', slug: 'storage' },
};

/** Read a feature from a URL or a query string; anything else is dropped. */
export function parseHousingFeature(value: unknown): HousingFeature | undefined {
  return typeof value === 'string' && (HOUSING_FEATURES as readonly string[]).includes(value)
    ? (value as HousingFeature)
    : undefined;
}

/**
 * The amenity slugs a feature selection requires, in one list.
 *
 * Separated from the column half because the two combine differently: the
 * slugs join the caller's own `amenities` filter, which already means ALL of
 * them, while each column feature is its own predicate.
 */
export function amenitySlugsForFeatures(features: readonly HousingFeature[]): string[] {
  const slugs = new Set<string>();
  for (const feature of features) {
    const source = HOUSING_FEATURE_SOURCE[feature];
    if (source.kind === 'amenity') slugs.add(source.slug);
  }
  return [...slugs];
}

/** The features answered by a column, for the caller that builds predicates. */
export function columnFeatures(features: readonly HousingFeature[]): HousingFeature[] {
  return features.filter((feature) => HOUSING_FEATURE_SOURCE[feature].kind === 'column');
}
