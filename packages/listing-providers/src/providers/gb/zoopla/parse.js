"use strict";
/**
 * Zoopla parsers (United Kingdom).
 *
 * Zoopla fronts Cloudflare — cold HTTP usually 403. Prefer a warmed Playwright
 * session, then parse `__NEXT_DATA__` / listing JSON when present, else
 * `/to-rent/details/<id>/` link scrape for discover.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.zooplaSourceIdFromUrl = zooplaSourceIdFromUrl;
exports.zooplaDetailUrl = zooplaDetailUrl;
exports.zooplaSearchUrl = zooplaSearchUrl;
exports.parseZooplaSearch = parseZooplaSearch;
exports.parseZooplaDetail = parseZooplaDetail;
const contact_1 = require("../../../parse/contact");
const housing_1 = require("../housing");
const fixtures_1 = require("./fixtures");
const NEXT_DATA_RE = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
const DETAIL_RE = /https?:\/\/www\.zoopla\.co\.uk\/(?:to-rent|for-sale)\/details\/(\d+)\/?/gi;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asString(value) {
    if (typeof value === 'string' && value.trim().length > 0)
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return undefined;
}
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const cleaned = value.replace(/[^0-9.]/g, '');
        if (!cleaned)
            return undefined;
        const parsed = Number.parseFloat(cleaned);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
function zooplaSourceIdFromUrl(url) {
    const match = url.match(/\/details\/(\d+)/i);
    return match?.[1];
}
function zooplaDetailUrl(sourceId, kind = 'rent') {
    const path = kind === 'rent' ? 'to-rent' : 'for-sale';
    return `${fixtures_1.ZOOPLA_BASE_URL}/${path}/details/${sourceId}/`;
}
function zooplaSearchUrl(city, page = 1) {
    const slug = city
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const base = `${fixtures_1.ZOOPLA_BASE_URL}/to-rent/property/${slug}/`;
    return page <= 1 ? base : `${base}?pn=${page}`;
}
function parseZooplaSearch(html) {
    const byId = new Map();
    for (const match of html.matchAll(DETAIL_RE)) {
        const sourceId = match[1];
        if (!sourceId || byId.has(sourceId))
            continue;
        const start = Math.max(0, (match.index ?? 0) - 120);
        const ctx = html.slice(start, (match.index ?? 0) + match[0].length + 40);
        if (!(0, housing_1.isGbHousingType)(ctx) && /garage|parking|storage|land\b/i.test(ctx))
            continue;
        const kind = /for-sale/i.test(match[0]) ? 'sale' : 'rent';
        byId.set(sourceId, { url: zooplaDetailUrl(sourceId, kind), kind });
    }
    // Also try __NEXT_DATA__ listing cards when present.
    const next = NEXT_DATA_RE.exec(html);
    if (next?.[1]) {
        try {
            const parsed = JSON.parse(next[1]);
            collectZooplaListingIds(parsed, byId, 0);
        }
        catch {
            // ignore
        }
    }
    return [...byId.entries()].map(([sourceId, value]) => ({
        sourceId,
        url: value.url,
        kind: value.kind,
    }));
}
function collectZooplaListingIds(node, out, depth) {
    if (depth > 14)
        return;
    if (Array.isArray(node)) {
        for (const entry of node)
            collectZooplaListingIds(entry, out, depth + 1);
        return;
    }
    if (!isRecord(node))
        return;
    const listingId = asString(node.listingId) ??
        asString(node.listing_id) ??
        (asNumber(node.listingId) !== undefined ? String(Math.trunc(asNumber(node.listingId))) : undefined);
    if (listingId && /^\d{5,}$/.test(listingId) && !out.has(listingId)) {
        const title = asString(node.title) ?? asString(node.propertyType) ?? asString(node.property_type);
        if ((0, housing_1.isGbHousingType)(title)) {
            const status = asString(node.listingStatus) ?? asString(node.status) ?? 'rent';
            const kind = /sale/i.test(status) ? 'sale' : 'rent';
            out.set(listingId, { url: zooplaDetailUrl(listingId, kind), kind });
        }
    }
    for (const value of Object.values(node))
        collectZooplaListingIds(value, out, depth + 1);
}
function findListingNode(node, depth = 0) {
    if (depth > 16)
        return undefined;
    if (Array.isArray(node)) {
        for (const entry of node) {
            const found = findListingNode(entry, depth + 1);
            if (found)
                return found;
        }
        return undefined;
    }
    if (!isRecord(node))
        return undefined;
    const hasId = node.listingId !== undefined || node.listing_id !== undefined;
    const hasPrice = node.price !== undefined || node.pricing !== undefined;
    if (hasId && hasPrice)
        return node;
    for (const value of Object.values(node)) {
        const found = findListingNode(value, depth + 1);
        if (found)
            return found;
    }
    return undefined;
}
function imagesFromNode(node) {
    const out = [];
    const push = (entry) => {
        if (typeof entry === 'string' && entry.startsWith('http')) {
            out.push(entry);
            return;
        }
        if (isRecord(entry)) {
            const url = asString(entry.url) ?? asString(entry.src) ?? asString(entry.original);
            if (url?.startsWith('http'))
                out.push(url);
        }
    };
    for (const key of ['image', 'images', 'photos', 'propertyImage', 'gallery']) {
        const value = node[key];
        if (Array.isArray(value))
            value.forEach(push);
        else
            push(value);
    }
    return [...new Set(out)];
}
function priceFromNode(node) {
    if (isRecord(node.pricing)) {
        return (asNumber(node.pricing.price) ??
            asNumber(node.pricing.rentPrice) ??
            asNumber(node.pricing.amount));
    }
    if (isRecord(node.price)) {
        return asNumber(node.price.amount) ?? asNumber(node.price.value);
    }
    return asNumber(node.price) ?? asNumber(node.rentalPrice);
}
function parseZooplaDetail(html, url, kindHint = 'rent') {
    const sourceId = zooplaSourceIdFromUrl(url);
    if (!sourceId)
        throw new Error(`zoopla: cannot parse source id from ${url}`);
    const next = NEXT_DATA_RE.exec(html);
    if (next?.[1]) {
        try {
            const parsed = JSON.parse(next[1]);
            const node = findListingNode(parsed);
            if (node) {
                const propertyType = asString(node.propertyType) ?? asString(node.property_type) ?? asString(node.title);
                if (!(0, housing_1.isGbHousingType)(propertyType)) {
                    throw new Error(`zoopla: non-housing listing rejected at ${url}`);
                }
                const status = asString(node.listingStatus) ?? asString(node.status);
                const kind = status && /sale/i.test(status) ? 'sale' : kindHint;
                const address = isRecord(node.address) ? node.address : undefined;
                const location = isRecord(node.location) ? node.location : isRecord(node.coordinates) ? node.coordinates : undefined;
                const agent = node.branch ?? node.agent ?? node.advertiser;
                return {
                    sourceId,
                    url: zooplaDetailUrl(sourceId, kind),
                    kind,
                    displayAddress: asString(node.displayAddress) ??
                        (address ? asString(address.fullAddress) ?? asString(address.postalAddress) : undefined),
                    summary: asString(node.summary) ?? asString(node.title),
                    description: asString(node.description),
                    bedrooms: asNumber(node.numBedrooms) ?? asNumber(node.bedrooms),
                    bathrooms: asNumber(node.numBathrooms) ?? asNumber(node.bathrooms),
                    propertyType,
                    priceAmount: priceFromNode(node),
                    priceCurrency: 'GBP',
                    latitude: location ? asNumber(location.latitude) ?? asNumber(location.lat) : undefined,
                    longitude: location ? asNumber(location.longitude) ?? asNumber(location.lng) ?? asNumber(location.lon) : undefined,
                    images: imagesFromNode(node),
                    contact: (0, contact_1.contactFromUnknown)(agent) ?? (0, contact_1.buildContact)({
                        phone: asString(node.phone),
                        agencyName: asString(node.agentName),
                        kind: 'agency',
                    }),
                };
            }
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('non-housing'))
                throw error;
        }
    }
    // Minimal HTML fallback from title / og tags when JSON missing.
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
    if (title && !(0, housing_1.isGbHousingType)(title)) {
        throw new Error(`zoopla: non-housing listing rejected at ${url}`);
    }
    const priceMatch = title?.match(/£([\d,]+)/);
    const images = [
        ...new Set([...html.matchAll(/https:\/\/lid\.zoocdn\.com\/[^"'>\s]+/gi)].map((m) => m[0])),
    ];
    return {
        sourceId,
        url: zooplaDetailUrl(sourceId, kindHint),
        kind: kindHint,
        displayAddress: title,
        priceAmount: asNumber(priceMatch?.[1]),
        priceCurrency: 'GBP',
        images,
    };
}
