/**
 * milanuncios.com (Spain) — general classifieds, REAL-ESTATE ONLY.
 *
 * Classifieds providers must scope discover to real-estate categories and reject
 * non-housing in normalize. This plugin:
 *   1. Discovers ONLY via housing category URL allowlist (inmobiliaria / pisos /
 *      alquiler / venta / habitaciones / vacacional) — never site-wide search.
 *   2. Prefers JSON/AJAX listing APIs via a warmed Playwright session (GeeTest
 *      blocks cold HTTP). HTML is last resort.
 *   3. `normalize()` hard-rejects cars/jobs/electronics via {@link assertHousingListing}.
 *
 * Registered OFF by default (`PROVIDER_MILANUNCIOS_ENABLED`). Do NOT enable in
 * prod until the housing filter + session path are verified end-to-end.
 */

export const MILANUNCIOS_BASE_URL = 'https://www.milanuncios.com';

/**
 * Allowlisted category path slugs for discover. Site-wide `/anuncios/` or
 * motor/empleo paths are intentionally absent.
 */
export const MILANUNCIOS_HOUSING_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
  'inmobiliaria',
  'alquiler-de-pisos',
  'venta-de-pisos',
  'alquiler-de-habitaciones',
  'alquiler-vacacional',
  'venta-de-casas',
  'alquiler-de-casas',
  'venta-de-chalets',
  'alquiler-de-chalets',
  'venta-de-aticos',
  'alquiler-de-aticos',
  'venta-de-duplex',
  'alquiler-de-duplex',
  'compartir-piso',
]);

/** Category ids observed on milanuncios inmobiliaria taxonomy (allowlist). */
export const MILANUNCIOS_HOUSING_CATEGORY_IDS: ReadonlySet<string> = new Set([
  // Inmobiliaria root + common housing children (portal-shaped; hand-maintained).
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'inmobiliaria',
]);

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Housing-only search URL for a city (alquiler de pisos). */
export function milanunciosHousingSearchUrl(city: string, page = 1): string {
  const base = `${MILANUNCIOS_BASE_URL}/alquiler-de-pisos-en-${citySlug(city)}/`;
  return page <= 1 ? base : `${base}?pagina=${page}`;
}

/** Alternate inmobiliaria category URL. */
export function milanunciosInmobiliariaSearchUrl(city: string, page = 1): string {
  const base = `${MILANUNCIOS_BASE_URL}/inmobiliaria-en-${citySlug(city)}/`;
  return page <= 1 ? base : `${base}?pagina=${page}`;
}

/**
 * AJAX/list endpoint candidates (tried from a warmed session). Response shapes
 * vary; parsers accept several wrappers. Cold HTTP returns GeeTest 405.
 */
export function milanunciosListAjaxUrl(city: string, page = 1): string {
  const params = new URLSearchParams({
    categorySlug: 'alquiler-de-pisos',
    locationSlug: citySlug(city),
    page: String(page),
  });
  return `${MILANUNCIOS_BASE_URL}/api/v3/adverts?${params.toString()}`;
}

/** Hand-authored housing advert JSON (portal-shaped). */
export const MILANUNCIOS_FIXTURE_HOUSING_JSON = JSON.stringify({
  id: '5123456789',
  category: { id: '2', slug: 'alquiler-de-pisos', name: 'Alquiler de pisos' },
  title: 'Piso 2 hab en Chamberí',
  description: 'Piso luminoso de 75 m² en Chamberí, amueblado.',
  price: 1400,
  currency: 'EUR',
  operation: 'rent',
  typology: 'piso',
  rooms: 2,
  bathrooms: 1,
  size: 75,
  url: 'https://www.milanuncios.com/alquiler-de-pisos-en-madrid/piso-chamberi-5123456789.htm',
  location: { city: 'Madrid', neighborhood: 'Chamberí', province: 'Madrid' },
  images: [
    'https://img.milanuncios.com/example/5123456789/1.jpg',
    'https://img.milanuncios.com/example/5123456789/2.jpg',
  ],
  contact: { phone: '612345678', name: 'Inmobiliaria Chamberí SL' },
});

/** Hand-authored car advert JSON — MUST be rejected by normalize. */
export const MILANUNCIOS_FIXTURE_CAR_JSON = JSON.stringify({
  id: '5987654321',
  category: { id: '20', slug: 'coches', name: 'Coches' },
  title: 'BMW Serie 3 diésel',
  description: 'Coche en buen estado, 120.000 km.',
  price: 12500,
  currency: 'EUR',
  url: 'https://www.milanuncios.com/coches-en-madrid/bmw-serie-3-5987654321.htm',
  location: { city: 'Madrid', province: 'Madrid' },
  images: ['https://img.milanuncios.com/example/5987654321/1.jpg'],
  contact: { phone: '600111222' },
});

/** Search AJAX wrapper with one housing advert. */
export const MILANUNCIOS_FIXTURE_SEARCH_JSON = JSON.stringify({
  adverts: [JSON.parse(MILANUNCIOS_FIXTURE_HOUSING_JSON)],
  pagination: { page: 1, total: 1 },
});
