"use strict";
/**
 * Immobiliare.it JSON / `__NEXT_DATA__` parsing (pure, JSON-first).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.immobiliareSourceIdFromUrl = immobiliareSourceIdFromUrl;
exports.immobiliareWarmSearchUrl = immobiliareWarmSearchUrl;
exports.immobiliareSearchApiUrls = immobiliareSearchApiUrls;
exports.parseImmobiliareSearchJson = parseImmobiliareSearchJson;
exports.parseImmobiliareSearch = parseImmobiliareSearch;
exports.parseImmobiliareDetail = parseImmobiliareDetail;
const contact_1 = require("../../../parse/contact");
const fixtures_1 = require("./fixtures");
const NEXT_DATA_RE = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
const DETAIL_LINK_RE = /\/annunci\/(\d+)\/?/gi;
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value.replace(/[^0-9.,-]/g, '').replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
function asString(value) {
    if (typeof value === 'string' && value.trim())
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return undefined;
}
function immobiliareSourceIdFromUrl(url) {
    return url.match(/\/annunci\/(\d+)/)?.[1];
}
function immobiliareWarmSearchUrl(city, page = 1) {
    const slug = city
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const base = `${fixtures_1.IMMOBILIARE_BASE_URL}/affitto-case/${slug}/`;
    return page <= 1 ? base : `${base}?pag=${page}`;
}
/** Candidate search-list AJAX URLs tried after warm-up (JSON-first). */
function immobiliareSearchApiUrls(city, page = 1) {
    const slug = city
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const pag = Math.max(1, page);
    return [
        `${fixtures_1.IMMOBILIARE_BASE_URL}/api-next/search-list/listings/?idCategoria=1&idContratto=2&idTipologia=0&idNazione=IT&criterio=rilevanza&__lang=it&pag=${pag}&paramsCount=1&path=%2Faffitto-case%2F${slug}%2F`,
        `${fixtures_1.IMMOBILIARE_BASE_URL}/api-next/search-list/listings/?fkRegione=&idContratto=2&idCategoria=1&idTipologia=&idLocalita=&prezzoMinimo=&prezzoMassimo=&superficieMinima=&superficieMassima=&bagni=&localiMinimo=&localiMassimo=&pag=${pag}&path=/affitto-case/${slug}/`,
    ];
}
function priceFromUnknown(value) {
    if (typeof value === 'number')
        return value;
    const record = asRecord(value);
    if (!record)
        return asNumber(value);
    return asNumber(record.value) ?? asNumber(record.price) ?? asNumber(record.raw);
}
function operationFromContract(value, url) {
    const raw = asString(value)?.toLowerCase() ?? '';
    if (/vendita|sale|sell/.test(raw) || url.includes('/vendita'))
        return 'sale';
    return 'rent';
}
function collectImages(value) {
    const out = [];
    const walk = (node) => {
        if (typeof node === 'string' && node.startsWith('http')) {
            out.push(node);
            return;
        }
        if (Array.isArray(node)) {
            for (const entry of node)
                walk(entry);
            return;
        }
        const record = asRecord(node);
        if (!record)
            return;
        const urls = asRecord(record.urls);
        const url = asString(record.url) ??
            asString(urls?.large) ??
            asString(urls?.medium) ??
            asString(record.src);
        if (url?.startsWith('http'))
            out.push(url);
        for (const key of ['photos', 'medias', 'images', 'gallery']) {
            if (key in record)
                walk(record[key]);
        }
    };
    walk(value);
    return [...new Set(out)];
}
function listingFromRecord(record, fallbackUrl) {
    const nested = asRecord(record.realEstate) ?? record;
    const id = asString(nested.id) ??
        asString(record.id) ??
        (fallbackUrl ? immobiliareSourceIdFromUrl(fallbackUrl) : undefined);
    if (!id)
        return undefined;
    const url = asString(record.seoUrl) ??
        asString(record.url) ??
        asString(record.link) ??
        asString(asRecord(record.seoData)?.url) ??
        `${fixtures_1.IMMOBILIARE_BASE_URL}/annunci/${id}/`;
    const location = asRecord(nested.location) ?? asRecord(record.location) ?? {};
    const typology = asRecord(nested.typology) ?? asRecord(record.typology);
    const props0 = Array.isArray(nested.properties) ? asRecord(nested.properties[0]) : undefined;
    const advertiser = (0, contact_1.contactFromAdvertiser)(nested.advertiser) ??
        (0, contact_1.contactFromAdvertiser)(asRecord(nested.advertiser)?.agency) ??
        (0, contact_1.contactFromAdvertiser)(record.advertiser);
    const raw = {
        sourceId: id,
        url: url.startsWith('http') ? url : `${fixtures_1.IMMOBILIARE_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`,
        currency: 'EUR',
        operation: operationFromContract(nested.contract ?? record.contract, url),
        images: collectImages(nested.photos ?? nested.medias ?? record.medias ?? record.photos),
        amenities: [],
    };
    const title = asString(nested.title) ?? asString(record.title);
    if (title)
        raw.title = title;
    const description = asString(nested.description) ?? asString(record.description);
    if (description)
        raw.description = description;
    const price = priceFromUnknown(nested.price ?? record.price);
    if (price !== undefined)
        raw.price = price;
    const propertyType = asString(typology?.name) ?? asString(nested.type);
    if (propertyType)
        raw.propertyType = propertyType;
    const bedrooms = asNumber(nested.rooms) ?? asNumber(props0?.rooms) ?? asNumber(record.rooms);
    if (bedrooms !== undefined)
        raw.bedrooms = bedrooms;
    const bathrooms = asNumber(nested.bathrooms) ?? asNumber(props0?.bathrooms) ?? asNumber(record.bathrooms);
    if (bathrooms !== undefined)
        raw.bathrooms = bathrooms;
    const squareMeters = asNumber(nested.surface) ?? asNumber(props0?.surface) ?? asNumber(record.surface);
    if (squareMeters !== undefined)
        raw.squareMeters = squareMeters;
    const floor = asNumber(nested.floor) ?? asNumber(props0?.floor);
    if (floor !== undefined)
        raw.floor = floor;
    const street = asString(location.address) ?? asString(location.street);
    if (street)
        raw.street = street;
    const city = asString(location.city) ?? asString(location.town);
    if (city)
        raw.city = city;
    const region = asString(location.region) ?? asString(location.province);
    if (region)
        raw.region = region;
    const postalCode = asString(location.postalCode) ?? asString(location.zipCode);
    if (postalCode)
        raw.postalCode = postalCode;
    const neighborhood = asString(location.macrozone) ?? asString(location.microzone);
    if (neighborhood)
        raw.neighborhood = neighborhood;
    const lat = asNumber(location.latitude) ?? asNumber(location.lat);
    const lng = asNumber(location.longitude) ?? asNumber(location.lng);
    if (lat !== undefined && lng !== undefined)
        raw.coordinates = { lat, lng };
    if (advertiser)
        raw.contact = advertiser;
    return raw;
}
function collectListings(value, out) {
    if (Array.isArray(value)) {
        for (const entry of value)
            collectListings(entry, out);
        return;
    }
    const record = asRecord(value);
    if (!record)
        return;
    const asListing = listingFromRecord(record);
    if (asListing && asListing.price !== undefined) {
        out.push(asListing);
    }
    else if (asListing) {
        out.push(asListing);
    }
    for (const key of [
        'results',
        'listings',
        'items',
        'ads',
        'data',
        'realEstates',
        'properties',
        'state',
        'queries',
        'pageProps',
        'detailData',
        'dehydratedState',
        'props',
    ]) {
        if (key in record)
            collectListings(record[key], out);
    }
}
/** Parse search-list AJAX JSON into de-duplicated refs (and optional rich rows). */
function parseImmobiliareSearchJson(body) {
    const trimmed = body.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('['))
        return [];
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        return [];
    }
    const listings = [];
    collectListings(parsed, listings);
    const seen = new Set();
    const refs = [];
    for (const listing of listings) {
        if (seen.has(listing.sourceId))
            continue;
        seen.add(listing.sourceId);
        refs.push({ sourceId: listing.sourceId, url: listing.url });
    }
    return refs;
}
/** Parse search HTML: prefer `__NEXT_DATA__`, merge with `/annunci/<id>/` links. */
function parseImmobiliareSearch(html) {
    const seen = new Map();
    const next = html.match(NEXT_DATA_RE)?.[1];
    if (next) {
        for (const ref of parseImmobiliareSearchJson(next)) {
            seen.set(ref.sourceId, ref.url);
        }
    }
    for (const match of html.matchAll(DETAIL_LINK_RE)) {
        const sourceId = match[1];
        if (!sourceId || seen.has(sourceId))
            continue;
        seen.set(sourceId, `${fixtures_1.IMMOBILIARE_BASE_URL}/annunci/${sourceId}/`);
    }
    return [...seen.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}
/** Parse detail HTML — `__NEXT_DATA__` is required (JSON-first). */
function parseImmobiliareDetail(html, url) {
    const next = html.match(NEXT_DATA_RE)?.[1];
    if (!next) {
        throw new Error(`immobiliare: no __NEXT_DATA__ JSON found at ${url}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(next);
    }
    catch {
        throw new Error(`immobiliare: malformed __NEXT_DATA__ at ${url}`);
    }
    const listings = [];
    collectListings(parsed, listings);
    const byUrl = listings.find((listing) => listing.url.includes(immobiliareSourceIdFromUrl(url) ?? ''));
    const listing = byUrl ?? listings.find((entry) => entry.price !== undefined) ?? listings[0];
    if (!listing) {
        throw new Error(`immobiliare: no listing object in __NEXT_DATA__ at ${url}`);
    }
    if (!listing.contact) {
        listing.contact = (0, contact_1.mergeContact)((0, contact_1.contactFromAdvertiser)(parsed));
    }
    return listing;
}
