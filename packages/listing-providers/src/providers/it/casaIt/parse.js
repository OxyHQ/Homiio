"use strict";
/**
 * Casa.it parsing — JSON search AJAX + JSON-LD detail (pure).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.casaItSourceIdFromUrl = casaItSourceIdFromUrl;
exports.casaItWarmSearchUrl = casaItWarmSearchUrl;
exports.casaItSearchApiUrl = casaItSearchApiUrl;
exports.parseCasaItSearchJson = parseCasaItSearchJson;
exports.parseCasaItSearch = parseCasaItSearch;
exports.parseCasaItDetail = parseCasaItDetail;
const contact_1 = require("../../../parse/contact");
const jsonLd_1 = require("../../../parse/jsonLd");
const fixtures_1 = require("./fixtures");
const DETAIL_LINK_RE = /href=["']([^"']*\/immobili\/(\d+)\/?[^"']*)["']/gi;
const CONTACT_JSON_RE = /<script[^>]*(?:id=["']listing-contact["']|type=["']application\/json["'][^>]*id=["']listing-contact["'])[^>]*>([\s\S]*?)<\/script>/i;
function casaItSourceIdFromUrl(url) {
    return url.match(/\/immobili\/(\d+)/)?.[1];
}
function casaItWarmSearchUrl(city, page = 1) {
    const slug = city
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const base = `${fixtures_1.CASA_IT_BASE_URL}/affitto/${slug}/`;
    return page <= 1 ? base : `${base}?page=${page}`;
}
function casaItSearchApiUrl(city, page = 1) {
    const slug = city
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${fixtures_1.CASA_IT_BASE_URL}/api/search/listings?contract=rent&city=${encodeURIComponent(slug)}&page=${page}`;
}
function collectRefs(value, out) {
    if (typeof value === 'string') {
        const id = casaItSourceIdFromUrl(value);
        if (id)
            out.set(id, `${fixtures_1.CASA_IT_BASE_URL}/immobili/${id}/`);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value)
            collectRefs(entry, out);
        return;
    }
    if (typeof value === 'object' && value !== null) {
        const record = value;
        const idRaw = record.id ?? record.propertyId ?? record.adId;
        if (typeof idRaw === 'string' || typeof idRaw === 'number') {
            const sourceId = String(idRaw).replace(/\D/g, '');
            if (/^\d{5,}$/.test(sourceId)) {
                out.set(sourceId, `${fixtures_1.CASA_IT_BASE_URL}/immobili/${sourceId}/`);
            }
        }
        const url = record.url ?? record.detailUrl ?? record.link;
        if (typeof url === 'string') {
            const id = casaItSourceIdFromUrl(url);
            if (id)
                out.set(id, `${fixtures_1.CASA_IT_BASE_URL}/immobili/${id}/`);
        }
        for (const key of ['listings', 'results', 'items', 'ads', 'data', 'content']) {
            if (key in record)
                collectRefs(record[key], out);
        }
    }
}
function parseCasaItSearchJson(body) {
    const trimmed = body.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('['))
        return [];
    try {
        const out = new Map();
        collectRefs(JSON.parse(trimmed), out);
        return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
    }
    catch {
        return [];
    }
}
function parseCasaItSearch(html) {
    const seen = new Set();
    const refs = [];
    for (const match of html.matchAll(DETAIL_LINK_RE)) {
        const sourceId = match[2];
        if (!sourceId || seen.has(sourceId))
            continue;
        seen.add(sourceId);
        refs.push({ sourceId, url: `${fixtures_1.CASA_IT_BASE_URL}/immobili/${sourceId}/` });
    }
    return refs;
}
function resolveOperation(listing, url) {
    if (listing.operation)
        return listing.operation;
    return url.includes('/vendita') || url.includes('/compra') ? 'sale' : 'rent';
}
function parseCasaItDetail(html, url) {
    const listing = (0, jsonLd_1.pickItListing)((0, jsonLd_1.extractItSchemaListings)(html));
    if (!listing) {
        throw new Error(`casa_it: no real-estate JSON-LD found at ${url}`);
    }
    const canonicalUrl = listing.url ?? url;
    const sourceId = casaItSourceIdFromUrl(canonicalUrl) ?? casaItSourceIdFromUrl(url);
    if (!sourceId) {
        throw new Error(`casa_it: cannot derive a source id from ${url}`);
    }
    const contactMatch = html.match(CONTACT_JSON_RE)?.[1];
    let contact;
    if (contactMatch) {
        try {
            contact = (0, contact_1.contactFromAdvertiser)(JSON.parse(contactMatch));
        }
        catch {
            contact = undefined;
        }
    }
    return {
        sourceId,
        url: canonicalUrl,
        listing: { ...listing, operation: resolveOperation(listing, canonicalUrl) },
        contact,
    };
}
