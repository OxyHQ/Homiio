/**
 * indomio.es (Spain) — JSON-first with Playwright session warm-up.
 *
 * Cold HTTP / proxy Playwright currently Cloudflare-challenged. Prefer list/
 * detail JSON once a session clears. Registered OFF (`PROVIDER_INDOMIO_ENABLED`).
 */

export const INDOMIO_BASE_URL = 'https://www.indomio.es';

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function indomioSearchUrl(city: string, page = 1): string {
  const base = `${INDOMIO_BASE_URL}/alquiler/${citySlug(city)}/`;
  return page <= 1 ? base : `${base}?pagina=${page}`;
}

export function indomioListAjaxUrl(city: string, page = 1): string {
  const params = new URLSearchParams({
    idContratto: '2', // rent
    idNazione: 'ES',
    localita: citySlug(city),
    page: String(page),
  });
  return `${INDOMIO_BASE_URL}/api/search/listings?${params.toString()}`;
}

export const INDOMIO_FIXTURE_DETAIL_JSON = JSON.stringify({
  id: '876543210',
  url: 'https://www.indomio.es/anuncio/876543210/',
  title: 'Apartamento en alquiler en Gràcia',
  description: 'Apartamento de 68 m² en Gràcia, Barcelona.',
  price: 1650,
  currency: 'EUR',
  operation: 'rent',
  rooms: 2,
  bathrooms: 1,
  size: 68,
  address: { street: 'Carrer de Verdi', city: 'Barcelona', province: 'Barcelona', neighborhood: 'Gràcia' },
  images: ['https://cdn.indomio.es/example/876543210/1.jpg'],
  contact: { phone: '930000222', agencyName: 'Indomio Demo' },
});

export const INDOMIO_FIXTURE_SEARCH_JSON = JSON.stringify({
  listings: [{ id: '876543210', url: 'https://www.indomio.es/anuncio/876543210/' }],
});
