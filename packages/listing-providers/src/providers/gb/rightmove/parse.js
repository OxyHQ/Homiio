"use strict";
/**
 * Rightmove JSON parsers (pure).
 *
 * Discover prefers typeahead JSON + search-page `__NEXT_DATA__` properties
 * array. Detail prefers `window.__PAGE_MODEL` (compressed JSON graph) which
 * carries address, price, images, and contactInfo — not DOM scraping.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePageModelGraph = resolvePageModelGraph;
exports.rightmoveSourceIdFromUrl = rightmoveSourceIdFromUrl;
exports.rightmoveDetailUrl = rightmoveDetailUrl;
exports.parseRightmoveTypeahead = parseRightmoveTypeahead;
exports.parseRightmoveSearchJson = parseRightmoveSearchJson;
exports.parseRightmoveDetail = parseRightmoveDetail;
exports.rightmoveTypeaheadUrl = rightmoveTypeaheadUrl;
exports.rightmoveSearchUrl = rightmoveSearchUrl;
const contact_1 = require("../../../parse/contact");
const housing_1 = require("../housing");
const fixtures_1 = require("./fixtures");
const NEXT_DATA_RE = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
const PAGE_MODEL_RE = /window\.__PAGE_MODEL\s*=\s*(\{[\s\S]*?\})\s*;/;
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
/** Flatten Rightmove's compressed `__PAGE_MODEL` integer-pointer graph. */
function resolvePageModelGraph(data) {
    if (!Array.isArray(data) || data.length === 0 || !isRecord(data[0]))
        return undefined;
    const root = data[0];
    const propIdx = root.propertyData;
    if (typeof propIdx !== 'number' || !isRecord(data[propIdx]))
        return undefined;
    const resolve = (node, depth = 0) => {
        if (depth > 24)
            return node;
        if (typeof node === 'number' && node >= 0 && node < data.length) {
            const target = data[node];
            if (typeof target === 'number' || typeof target === 'string' || typeof target === 'boolean' || target === null) {
                return target;
            }
            return resolve(target, depth + 1);
        }
        if (Array.isArray(node))
            return node.map((entry) => resolve(entry, depth + 1));
        if (isRecord(node)) {
            const out = {};
            for (const [key, value] of Object.entries(node)) {
                out[key] = resolve(value, depth + 1);
            }
            return out;
        }
        return node;
    };
    const resolved = resolve(data[propIdx]);
    return isRecord(resolved) ? resolved : undefined;
}
function rightmoveSourceIdFromUrl(url) {
    const match = url.match(/\/properties\/(\d+)/i);
    return match?.[1];
}
function rightmoveDetailUrl(sourceId) {
    return `${fixtures_1.RIGHTMOVE_BASE_URL}/properties/${sourceId}`;
}
/** Parse typeahead JSON into the first REGION^id locationIdentifier. */
function parseRightmoveTypeahead(body) {
    try {
        const parsed = JSON.parse(body);
        const matches = isRecord(parsed) && Array.isArray(parsed.matches) ? parsed.matches : undefined;
        if (!matches)
            return undefined;
        for (const entry of matches) {
            if (!isRecord(entry))
                continue;
            const id = asString(entry.id);
            const type = asString(entry.type) ?? 'REGION';
            if (id)
                return `${type}^${id}`;
        }
    }
    catch {
        return undefined;
    }
    return undefined;
}
function priceFromSearchProperty(record) {
    if (!isRecord(record.price))
        return {};
    return {
        amount: asNumber(record.price.amount),
        currency: asString(record.price.currencyCode) ?? 'GBP',
        frequency: asString(record.price.frequency),
    };
}
function imagesFromSearchProperty(record) {
    if (!Array.isArray(record.images))
        return [];
    const out = [];
    for (const image of record.images) {
        if (!isRecord(image))
            continue;
        const url = asString(image.srcUrl) ?? asString(image.url);
        if (url?.startsWith('http'))
            out.push(url.replace(':443/', '/'));
    }
    return out;
}
function isHousingSearchProperty(record) {
    const sub = asString(record.propertySubType) ?? asString(record.propertyTypeFullDescription);
    return (0, housing_1.isGbHousingType)(sub);
}
/** Extract listing refs (+ optional card JSON) from search `__NEXT_DATA__`. */
function parseRightmoveSearchJson(html) {
    const match = NEXT_DATA_RE.exec(html);
    if (!match?.[1])
        return [];
    let parsed;
    try {
        parsed = JSON.parse(match[1]);
    }
    catch {
        return [];
    }
    const pageProps = isRecord(parsed) && isRecord(parsed.props) ? parsed.props.pageProps : undefined;
    const searchResults = isRecord(pageProps) ? pageProps.searchResults : undefined;
    const properties = isRecord(searchResults) && Array.isArray(searchResults.properties) ? searchResults.properties : [];
    const out = [];
    const seen = new Set();
    for (const entry of properties) {
        if (!isRecord(entry))
            continue;
        if (!isHousingSearchProperty(entry))
            continue;
        const id = asNumber(entry.id) ?? asNumber(asString(entry.id));
        if (id === undefined)
            continue;
        const sourceId = String(Math.trunc(id));
        if (seen.has(sourceId))
            continue;
        seen.add(sourceId);
        const price = priceFromSearchProperty(entry);
        const kind = price.frequency === 'monthly' || price.frequency === 'weekly' || price.frequency === 'yearly'
            ? 'rent'
            : 'sale';
        const location = isRecord(entry.location) ? entry.location : undefined;
        const card = {
            sourceId,
            url: rightmoveDetailUrl(sourceId),
            kind,
            displayAddress: asString(entry.displayAddress),
            summary: asString(entry.summary),
            bedrooms: asNumber(entry.bedrooms),
            bathrooms: asNumber(entry.bathrooms),
            propertySubType: asString(entry.propertySubType),
            priceAmount: price.amount,
            priceCurrency: price.currency,
            priceFrequency: price.frequency,
            countryCode: asString(entry.countryCode) ?? 'GB',
            latitude: location ? asNumber(location.latitude) : undefined,
            longitude: location ? asNumber(location.longitude) : undefined,
            images: imagesFromSearchProperty(entry),
        };
        out.push({ sourceId, url: card.url, kind, card });
    }
    return out;
}
function parsePrimaryPricePcm(prices) {
    if (!prices)
        return undefined;
    const primary = asString(prices.primaryPrice);
    if (!primary)
        return undefined;
    // "£3,400 pcm" or "£450,000"
    const pcm = primary.match(/£([\d,]+)\s*pcm/i);
    if (pcm?.[1])
        return asNumber(pcm[1]);
    const sale = primary.match(/£([\d,]+)/);
    return sale?.[1] ? asNumber(sale[1]) : undefined;
}
function imagesFromDetail(prop) {
    if (!Array.isArray(prop.images))
        return [];
    const out = [];
    for (const image of prop.images) {
        if (!isRecord(image))
            continue;
        const url = asString(image.url);
        if (url?.startsWith('http'))
            out.push(url);
    }
    return out;
}
function contactFromDetail(prop) {
    const contactInfo = isRecord(prop.contactInfo) ? prop.contactInfo : undefined;
    const phones = contactInfo && isRecord(contactInfo.telephoneNumbers) ? contactInfo.telephoneNumbers : undefined;
    const customer = isRecord(prop.customer) ? prop.customer : undefined;
    return (0, contact_1.buildContact)({
        phone: phones ? asString(phones.localNumber) ?? asString(phones.internationalNumber) : undefined,
        email: undefined,
        agencyName: (customer ? asString(customer.branchDisplayName) : undefined) ??
            (customer ? asString(customer.companyTradingName) : undefined) ??
            (customer ? asString(customer.companyName) : undefined),
        kind: 'agency',
    });
}
/** Parse a detail page's `__PAGE_MODEL` into a listing JSON payload. */
function parseRightmoveDetail(html, url) {
    const match = PAGE_MODEL_RE.exec(html);
    if (!match?.[1]) {
        throw new Error(`rightmove: no __PAGE_MODEL JSON at ${url}`);
    }
    let outer;
    try {
        outer = JSON.parse(match[1]);
    }
    catch {
        throw new Error(`rightmove: invalid __PAGE_MODEL JSON at ${url}`);
    }
    if (!isRecord(outer) || typeof outer.data !== 'string') {
        throw new Error(`rightmove: unexpected __PAGE_MODEL shape at ${url}`);
    }
    let graph;
    try {
        graph = JSON.parse(outer.data);
    }
    catch {
        throw new Error(`rightmove: invalid __PAGE_MODEL data graph at ${url}`);
    }
    if (!Array.isArray(graph)) {
        throw new Error(`rightmove: __PAGE_MODEL data is not an array at ${url}`);
    }
    const prop = resolvePageModelGraph(graph);
    if (!prop) {
        throw new Error(`rightmove: could not resolve propertyData at ${url}`);
    }
    if (!(0, housing_1.isGbHousingType)(asString(prop.propertySubType))) {
        throw new Error(`rightmove: non-housing listing rejected at ${url}`);
    }
    const sourceId = asString(prop.id) ??
        (asNumber(prop.id) !== undefined ? String(Math.trunc(asNumber(prop.id))) : undefined) ??
        rightmoveSourceIdFromUrl(url);
    if (!sourceId) {
        throw new Error(`rightmove: missing property id at ${url}`);
    }
    const address = isRecord(prop.address) ? prop.address : undefined;
    const location = isRecord(prop.location) ? prop.location : undefined;
    const prices = isRecord(prop.prices) ? prop.prices : undefined;
    const text = isRecord(prop.text) ? prop.text : undefined;
    const channel = asString(prop.channel)?.toUpperCase();
    const transaction = asString(prop.transactionType)?.toUpperCase();
    const kind = channel === 'RENT' || transaction === 'RENT' || /pcm/i.test(asString(prices?.primaryPrice) ?? '')
        ? 'rent'
        : 'sale';
    const outcode = address ? asString(address.outcode) : undefined;
    const incode = address ? asString(address.incode) : undefined;
    return {
        sourceId,
        url: rightmoveDetailUrl(sourceId),
        kind,
        displayAddress: address ? asString(address.displayAddress) : undefined,
        description: text ? asString(text.description) ?? asString(text.shortDescription) : undefined,
        bedrooms: asNumber(prop.bedrooms),
        bathrooms: asNumber(prop.bathrooms),
        propertySubType: asString(prop.propertySubType),
        priceAmount: parsePrimaryPricePcm(prices),
        priceCurrency: 'GBP',
        priceFrequency: kind === 'rent' ? 'monthly' : undefined,
        countryCode: address ? asString(address.countryCode) ?? 'GB' : 'GB',
        outcode,
        incode,
        latitude: location ? asNumber(location.latitude) : undefined,
        longitude: location ? asNumber(location.longitude) : undefined,
        images: imagesFromDetail(prop),
        contact: contactFromDetail(prop),
    };
}
function rightmoveTypeaheadUrl(city) {
    return `https://los.rightmove.co.uk/typeahead?query=${encodeURIComponent(city)}`;
}
function rightmoveSearchUrl(locationIdentifier, kind, index = 0) {
    const path = kind === 'rent' ? 'property-to-rent' : 'property-for-sale';
    const channel = kind === 'rent' ? 'RENT' : 'BUY';
    const params = new URLSearchParams({
        locationIdentifier,
        index: String(index),
        sortType: '6',
        viewType: 'LIST',
        channel,
    });
    return `${fixtures_1.RIGHTMOVE_BASE_URL}/${path}/find.html?${params.toString()}`;
}
