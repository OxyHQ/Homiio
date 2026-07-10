"use strict";
/**
 * indomio.es (Spain) — JSON-first with Playwright session warm-up.
 *
 * Cold HTTP / proxy Playwright currently Cloudflare-challenged. Prefer list/
 * detail JSON once a session clears. Registered OFF (`PROVIDER_INDOMIO_ENABLED`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDOMIO_FIXTURE_SEARCH_JSON = exports.INDOMIO_FIXTURE_DETAIL_JSON = exports.INDOMIO_BASE_URL = void 0;
exports.indomioSearchUrl = indomioSearchUrl;
exports.indomioListAjaxUrl = indomioListAjaxUrl;
exports.INDOMIO_BASE_URL = 'https://www.indomio.es';
function citySlug(city) {
    return city
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
function indomioSearchUrl(city, page = 1) {
    const base = `${exports.INDOMIO_BASE_URL}/alquiler/${citySlug(city)}/`;
    return page <= 1 ? base : `${base}?pagina=${page}`;
}
function indomioListAjaxUrl(city, page = 1) {
    const params = new URLSearchParams({
        idContratto: '2', // rent
        idNazione: 'ES',
        localita: citySlug(city),
        page: String(page),
    });
    return `${exports.INDOMIO_BASE_URL}/api/search/listings?${params.toString()}`;
}
exports.INDOMIO_FIXTURE_DETAIL_JSON = JSON.stringify({
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
exports.INDOMIO_FIXTURE_SEARCH_JSON = JSON.stringify({
    listings: [{ id: '876543210', url: 'https://www.indomio.es/anuncio/876543210/' }],
});
