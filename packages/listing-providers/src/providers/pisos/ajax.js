"use strict";
/**
 * pisos.com AJAX / URL helpers (pure).
 *
 * Prefer structured JSON (search JSON-LD, detail `data-var` + tracking blob,
 * contact AJAX) over HTML scraping. Cold HTTP works for search/detail; contact
 * endpoints are best-effort and must not fail ingest on 403/empty.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pisosSearchUrl = pisosSearchUrl;
exports.pisosSaleSearchUrl = pisosSaleSearchUrl;
exports.pisosContactPhoneUrl = pisosContactPhoneUrl;
exports.parsePisosContactPhone = parsePisosContactPhone;
const fixtures_1 = require("./fixtures");
function citySlug(city) {
    return city
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
/** Rental search URL for a city + 1-based page. */
function pisosSearchUrl(city, page = 1) {
    const base = `${fixtures_1.PISOS_BASE_URL}/alquiler/pisos-${citySlug(city)}/`;
    return page <= 1 ? base : `${base}?pagina=${page}`;
}
/** Sale search URL (secondary discover path). */
function pisosSaleSearchUrl(city, page = 1) {
    const base = `${fixtures_1.PISOS_BASE_URL}/venta/pisos-${citySlug(city)}/`;
    return page <= 1 ? base : `${base}?pagina=${page}`;
}
/** Contact phone AJAX (best-effort; often returns `{ phone: null }`). */
function pisosContactPhoneUrl(sourceId) {
    return `${fixtures_1.PISOS_BASE_URL}/WebsiteUserInfo/GetNormalizedPhone?id=${encodeURIComponent(sourceId)}`;
}
/** Parse a contact AJAX JSON body into a phone string when present. */
function parsePisosContactPhone(body) {
    const trimmed = body.trim();
    if (!trimmed.startsWith('{'))
        return undefined;
    try {
        const record = JSON.parse(trimmed);
        if (typeof record.normalizedPhone === 'string' && record.normalizedPhone.trim()) {
            return record.normalizedPhone.trim();
        }
        if (typeof record.phone === 'string' && record.phone.trim()) {
            return record.phone.trim();
        }
    }
    catch {
        return undefined;
    }
    return undefined;
}
