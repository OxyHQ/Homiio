/**
 * yaencontre.com (Spain) — JSON-first with Playwright session warm-up.
 *
 * Cold HTTP and even residential-proxy Playwright currently hit Cloudflare
 * (challenge HTML ~1.5 KB). The provider still prefers AJAX/JSON once a session
 * clears; HTML is last resort. Registered OFF (`PROVIDER_YAENCONTRE_ENABLED`).
 */

export const YAENCONTRE_BASE_URL = 'https://www.yaencontre.com';

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function yaencontreSearchUrl(city: string, page = 1): string {
  const base = `${YAENCONTRE_BASE_URL}/alquiler/pisos/${citySlug(city)}`;
  return page <= 1 ? base : `${base}?pagina=${page}`;
}

/** Search/list AJAX candidate (tried from warmed session). */
export function yaencontreListAjaxUrl(city: string, page = 1): string {
  const params = new URLSearchParams({
    operation: 'rent',
    propertyType: 'homes',
    location: citySlug(city),
    page: String(page),
  });
  return `${YAENCONTRE_BASE_URL}/api/search?${params.toString()}`;
}

export const YAENCONTRE_FIXTURE_DETAIL_JSON = JSON.stringify({
  id: '987654321',
  url: 'https://www.yaencontre.com/alquiler/piso/madrid/987654321',
  title: 'Piso en alquiler en Salamanca',
  description: 'Piso de 90 m² con 3 habitaciones en Salamanca.',
  price: 2100,
  currency: 'EUR',
  operation: 'rent',
  rooms: 3,
  bathrooms: 2,
  size: 90,
  address: { street: 'Calle de Serrano', city: 'Madrid', province: 'Madrid', neighborhood: 'Salamanca' },
  images: ['https://cdn.yaencontre.com/example/987654321/1.jpg'],
  contact: { phone: '910000111', agencyName: 'Yaencontre Demo Agency' },
});

export const YAENCONTRE_FIXTURE_SEARCH_JSON = JSON.stringify({
  results: [{ id: '987654321', url: 'https://www.yaencontre.com/alquiler/piso/madrid/987654321' }],
});
