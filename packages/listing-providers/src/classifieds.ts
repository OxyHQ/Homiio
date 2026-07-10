/**
 * Shared classifieds / housing-only guards.
 *
 * General classifieds portals (OLX, milanuncios, subito, kleinanzeigen,
 * leboncoin marketplace, …) must NEVER be site-wide crawled:
 *   1. `discover()` — housing category URL/API allowlist only
 *   2. `normalize()` — {@link assertHousingListing} / category checks
 *
 * Dedicated real-estate portals (Idealista, Storia, Imobiliare.ro, …) skip this.
 *
 * This is the ONE chokepoint — `providers/es/housing` re-exports from here.
 */

/** Raised when a classifieds payload is not a housing listing. */
export class NonHousingListingError extends Error {
  constructor(
    readonly provider: string,
    readonly sourceId: string,
    readonly reason: string,
  ) {
    super(`${provider}: rejecting non-housing listing ${sourceId}: ${reason}`);
    this.name = 'NonHousingListingError';
  }
}

const HOUSING_CATEGORY_TOKENS: ReadonlySet<string> = new Set([
  'inmobiliaria', 'inmueble', 'inmuebles', 'vivienda', 'viviendas', 'piso', 'pisos',
  'apartamento', 'apartamentos', 'casa', 'casas', 'chalet', 'chalets', 'atico', 'duplex',
  'estudio', 'habitacion', 'habitaciones', 'alquiler', 'venta', 'rent', 'sale', 'holiday',
  'vacacional', 'vacanze', 'immobiliare', 'immobili', 'appartamenti', 'case', 'affitto',
  'vendita', 'immobilier', 'locations', 'ventes', 'immobilier-location', 'immobilier-vente',
  'haus_kaufen', 'haus_mieten', 'wohnung_kaufen', 'wohnung_mieten', 'immobilien',
  'real-estate', 'realestate', 'real_estate', 'property', 'properties',
  // RO
  'imobiliare', 'apartament', 'apartamente', 'garsoniera', 'garsoniere', 'casa', 'case',
  'inchiriere', 'inchirieri', 'vanzare', 'teren', 'terenuri', 'locuinta', 'locuinte',
]);

const NON_HOUSING_CATEGORY_TOKENS: ReadonlySet<string> = new Set([
  'coche', 'coches', 'moto', 'motos', 'motor', 'auto', 'autos', 'car', 'cars', 'vehicle',
  'empleo', 'trabajo', 'jobs', 'job', 'electronica', 'moviles', 'telefonia', 'informatica',
  'moda', 'deportes', 'servicios', 'mascotas', 'bebes', 'hogar', 'muebles', 'jardin',
  'formacion', 'negocio', 'negocios',
  // RO non-housing
  'locdemunca', 'angajare', 'masina', 'masini', 'electronice', 'mobila', 'servicii',
  'automotive', 'electronics',
]);

function deaccent(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function tokenizeCategory(value: string): string[] {
  return deaccent(value).split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

export function isHousingCategory(category: string | undefined | null): boolean {
  if (!category || category.trim().length === 0) return false;
  // Full-slug forms (`real_estate`, `real-estate`) before token split.
  const slug = deaccent(category).replace(/[^a-z0-9]+/g, '_');
  const compact = slug.replace(/_/g, '');
  if (NON_HOUSING_CATEGORY_TOKENS.has(slug) || NON_HOUSING_CATEGORY_TOKENS.has(compact)) {
    return false;
  }
  if (HOUSING_CATEGORY_TOKENS.has(slug) || HOUSING_CATEGORY_TOKENS.has(compact)) {
    return true;
  }
  const tokens = tokenizeCategory(category);
  if (tokens.some((token) => NON_HOUSING_CATEGORY_TOKENS.has(token))) return false;
  return tokens.some((token) => HOUSING_CATEGORY_TOKENS.has(token));
}

export function isHousingCategoryUrl(url: string, allowlistSlugs: ReadonlySet<string>): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  const deaccented = deaccent(path);
  for (const slug of allowlistSlugs) {
    if (deaccented.includes(deaccent(slug))) return true;
  }
  return false;
}

export interface HousingSignalInput {
  category?: string;
  typology?: string;
  squareMeters?: number;
  bedrooms?: number;
  bathrooms?: number;
  hasAddressLike: boolean;
  hasPrice: boolean;
}

export function assertHousingListing(
  provider: string,
  sourceId: string,
  input: HousingSignalInput,
): void {
  if (!input.hasPrice) {
    throw new NonHousingListingError(provider, sourceId, 'missing price');
  }
  if (!input.hasAddressLike) {
    throw new NonHousingListingError(provider, sourceId, 'missing address-like fields');
  }
  const categoryOk = isHousingCategory(input.category) || isHousingCategory(input.typology);
  const propertySignals =
    (input.squareMeters !== undefined && input.squareMeters > 0) ||
    (input.bedrooms !== undefined && input.bedrooms >= 0) ||
    (input.bathrooms !== undefined && input.bathrooms > 0);
  if (input.category && tokenizeCategory(input.category).some((t) => NON_HOUSING_CATEGORY_TOKENS.has(t))) {
    throw new NonHousingListingError(provider, sourceId, `non-housing category "${input.category}"`);
  }
  if (!categoryOk && !propertySignals) {
    throw new NonHousingListingError(
      provider,
      sourceId,
      'category not housing-related and no m²/rooms/typology signals',
    );
  }
}
