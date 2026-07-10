"use strict";
/**
 * Idealista.it HTML / JSON-LD parsing (pure).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.idealistaItSourceIdFromUrl = idealistaItSourceIdFromUrl;
exports.parseIdealistaItDetail = parseIdealistaItDetail;
exports.parseIdealistaItSearch = parseIdealistaItSearch;
const jsonLd_1 = require("../../../parse/jsonLd");
const fixtures_1 = require("./fixtures");
const DETAIL_LINK_RE = /href=["']([^"']*\/immobile\/(\d+)\/[^"']*)["']/gi;
function idealistaItSourceIdFromUrl(url) {
    return url.match(/\/immobile\/(\d+)/)?.[1];
}
function resolveOperation(listing, url) {
    if (listing.operation)
        return listing.operation;
    return url.includes('/vendita') || url.includes('-vendita') ? 'sale' : 'rent';
}
function parseIdealistaItDetail(html, url) {
    const listing = (0, jsonLd_1.pickItListing)((0, jsonLd_1.extractItSchemaListings)(html));
    if (!listing) {
        throw new Error(`idealista_it: no real-estate JSON-LD found at ${url}`);
    }
    const canonicalUrl = listing.url ?? url;
    const sourceId = idealistaItSourceIdFromUrl(canonicalUrl) ?? idealistaItSourceIdFromUrl(url);
    if (!sourceId) {
        throw new Error(`idealista_it: cannot derive a source id from ${url}`);
    }
    return {
        sourceId,
        url: canonicalUrl,
        listing: { ...listing, operation: resolveOperation(listing, canonicalUrl) },
    };
}
function parseIdealistaItSearch(html) {
    const seen = new Set();
    const refs = [];
    for (const match of html.matchAll(DETAIL_LINK_RE)) {
        const sourceId = match[2];
        if (!sourceId || seen.has(sourceId))
            continue;
        seen.add(sourceId);
        refs.push({ sourceId, url: `${fixtures_1.IDEALISTA_IT_BASE_URL}/immobile/${sourceId}/` });
    }
    return refs;
}
