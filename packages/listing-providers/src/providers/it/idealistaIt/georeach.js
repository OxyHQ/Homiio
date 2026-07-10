"use strict";
/**
 * Idealista.it georeach AJAX discover helpers (pure).
 *
 * IT host mirrors ES layout with Italian path segments:
 *   warm: `/affitto-case/{city}/`
 *   detail: `/immobile/{id}/`
 *   georeach: `/it/ajax/listing/georeach/{city}-{province}`
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.idealistaItGeoreachSlug = idealistaItGeoreachSlug;
exports.idealistaItGeoreachUrl = idealistaItGeoreachUrl;
exports.idealistaItWarmSearchUrl = idealistaItWarmSearchUrl;
exports.isIdealistaItGeoreachChallenge = isIdealistaItGeoreachChallenge;
exports.parseIdealistaItGeoreach = parseIdealistaItGeoreach;
const fixtures_1 = require("./fixtures");
const parse_1 = require("./parse");
const GEOREACH_SLUGS = {
    roma: 'roma-roma',
    milano: 'milano-milano',
    napoli: 'napoli-napoli',
    torino: 'torino-torino',
    firenze: 'firenze-firenze',
    bologna: 'bologna-bologna',
};
function citySlug(city) {
    return city
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
function idealistaItGeoreachSlug(city) {
    const slug = citySlug(city);
    return GEOREACH_SLUGS[slug] ?? `${slug}-${slug}`;
}
function idealistaItGeoreachUrl(city, page = 1) {
    const slug = idealistaItGeoreachSlug(city);
    const base = `${fixtures_1.IDEALISTA_IT_BASE_URL}/it/ajax/listing/georeach/${slug}`;
    if (page <= 1)
        return base;
    return `${base}?page=${page}`;
}
function idealistaItWarmSearchUrl(city, page = 1) {
    const slug = citySlug(city);
    const base = `${fixtures_1.IDEALISTA_IT_BASE_URL}/affitto-case/${slug}/`;
    return page <= 1 ? base : `${base}pagina-${page}.htm`;
}
function isIdealistaItGeoreachChallenge(body) {
    const trimmed = body.trim();
    if (trimmed.length === 0)
        return true;
    if (/captcha-delivery\.com|geo\.captcha|datadome/i.test(trimmed))
        return true;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return /"url"\s*:\s*"https?:\/\/geo\.captcha/i.test(trimmed);
    }
    return false;
}
function refFromId(rawId) {
    if (typeof rawId !== 'string' && typeof rawId !== 'number')
        return undefined;
    const sourceId = String(rawId).replace(/\D/g, '');
    if (!/^\d{5,}$/.test(sourceId))
        return undefined;
    return { sourceId, url: `${fixtures_1.IDEALISTA_IT_BASE_URL}/immobile/${sourceId}/` };
}
function collectIdsFromRecord(record, out) {
    const candidates = [record.adId, record.adid, record.propertyCode, record.propertyId, record.id];
    for (const candidate of candidates) {
        const ref = refFromId(candidate);
        if (ref)
            out.set(ref.sourceId, ref.url);
    }
    const nestedUrl = record.url ?? record.detailUrl ?? record.link;
    if (typeof nestedUrl === 'string') {
        const sourceId = (0, parse_1.idealistaItSourceIdFromUrl)(nestedUrl);
        if (sourceId)
            out.set(sourceId, `${fixtures_1.IDEALISTA_IT_BASE_URL}/immobile/${sourceId}/`);
    }
}
function collectFromUnknown(value, out) {
    if (typeof value === 'string') {
        if (value.includes('/immobile/')) {
            for (const ref of (0, parse_1.parseIdealistaItSearch)(value)) {
                out.set(ref.sourceId, ref.url);
            }
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value)
            collectFromUnknown(entry, out);
        return;
    }
    if (typeof value === 'object' && value !== null) {
        const record = value;
        collectIdsFromRecord(record, out);
        for (const key of ['items', 'listings', 'ads', 'elements', 'data', 'result', 'content', 'html', 'body']) {
            if (key in record)
                collectFromUnknown(record[key], out);
        }
    }
}
function parseIdealistaItGeoreach(body) {
    const trimmed = body.trim();
    if (trimmed.length === 0 || isIdealistaItGeoreachChallenge(trimmed))
        return [];
    const out = new Map();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            collectFromUnknown(JSON.parse(trimmed), out);
        }
        catch {
            // Fall through to HTML parsing.
        }
    }
    if (out.size === 0 && trimmed.includes('/immobile/')) {
        for (const ref of (0, parse_1.parseIdealistaItSearch)(trimmed)) {
            out.set(ref.sourceId, ref.url);
        }
    }
    return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}
