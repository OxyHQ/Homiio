"use strict";
/**
 * yaencontre.com (Spain) — JSON-first with Playwright session warm-up.
 *
 * Cold HTTP and even residential-proxy Playwright currently hit Cloudflare
 * (challenge HTML ~1.5 KB). The provider still prefers AJAX/JSON once a session
 * clears; HTML is last resort. Registered OFF (`PROVIDER_YAENCONTRE_ENABLED`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.YAENCONTRE_FIXTURE_SEARCH_JSON = exports.YAENCONTRE_FIXTURE_DETAIL_JSON = exports.YAENCONTRE_BASE_URL = void 0;
exports.yaencontreSearchUrl = yaencontreSearchUrl;
exports.yaencontreListAjaxUrl = yaencontreListAjaxUrl;
exports.YAENCONTRE_BASE_URL = 'https://www.yaencontre.com';
function citySlug(city) {
    return city
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
function yaencontreSearchUrl(city, page = 1) {
    const base = `${exports.YAENCONTRE_BASE_URL}/alquiler/pisos/${citySlug(city)}`;
    return page <= 1 ? base : `${base}?pagina=${page}`;
}
/** Search/list AJAX candidate (tried from warmed session). */
function yaencontreListAjaxUrl(city, page = 1) {
    const params = new URLSearchParams({
        operation: 'rent',
        propertyType: 'homes',
        location: citySlug(city),
        page: String(page),
    });
    return `${exports.YAENCONTRE_BASE_URL}/api/search?${params.toString()}`;
}
exports.YAENCONTRE_FIXTURE_DETAIL_JSON = JSON.stringify({
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
exports.YAENCONTRE_FIXTURE_SEARCH_JSON = JSON.stringify({
    results: [{ id: '987654321', url: 'https://www.yaencontre.com/alquiler/piso/madrid/987654321' }],
});
