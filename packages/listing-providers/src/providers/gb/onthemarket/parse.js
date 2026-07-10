"use strict";
/**
 * OnTheMarket JSON parsers (pure).
 *
 * Detail pages embed listing JSON in `__NEXT_DATA__.props.initialReduxState.property`.
 * Search pages expose `/details/<id>` links; housing-only filter rejects garages etc.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onthemarketSourceIdFromUrl = onthemarketSourceIdFromUrl;
exports.onthemarketDetailUrl = onthemarketDetailUrl;
exports.onthemarketSearchUrl = onthemarketSearchUrl;
exports.parseOnTheMarketSearch = parseOnTheMarketSearch;
exports.parseOnTheMarketDetail = parseOnTheMarketDetail;
const contact_1 = require("../../../parse/contact");
const housing_1 = require("../housing");
const fixtures_1 = require("./fixtures");
const NEXT_DATA_RE = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
const DETAIL_ID_RE = /\/details\/(\d+)/g;
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
function onthemarketSourceIdFromUrl(url) {
    const match = url.match(/\/details\/(\d+)/i);
    return match?.[1];
}
function onthemarketDetailUrl(sourceId) {
    return `${fixtures_1.ONTHEMARKET_BASE_URL}/details/${sourceId}/`;
}
function onthemarketSearchUrl(city, page = 1) {
    const slug = city
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const base = `${fixtures_1.ONTHEMARKET_BASE_URL}/to-rent/property/${slug}/`;
    return page <= 1 ? base : `${base}?page=${page}`;
}
/** De-duplicated housing detail refs from a search HTML page. */
function parseOnTheMarketSearch(html) {
    const byId = new Map();
    for (const match of html.matchAll(/<a[^>]+href="(\/details\/(\d+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const sourceId = match[2];
        const label = match[3]?.replace(/<[^>]+>/g, ' ') ?? '';
        if (!sourceId || byId.has(sourceId))
            continue;
        if (!(0, housing_1.isGbHousingType)(label) || /garage|parking|storage/i.test(label))
            continue;
        byId.set(sourceId, onthemarketDetailUrl(sourceId));
    }
    // Fallback: bare /details/ids when anchors lack labels (still skip if nearby garage token).
    if (byId.size === 0) {
        for (const match of html.matchAll(DETAIL_ID_RE)) {
            const sourceId = match[1];
            if (!sourceId || byId.has(sourceId))
                continue;
            byId.set(sourceId, onthemarketDetailUrl(sourceId));
        }
    }
    return [...byId.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}
function imagesFromProperty(prop) {
    const out = [];
    if (Array.isArray(prop.images)) {
        for (const image of prop.images) {
            if (!isRecord(image))
                continue;
            const url = asString(image.largeUrl) ?? asString(image.url);
            if (url?.startsWith('http'))
                out.push(url);
        }
    }
    return out;
}
function contactFromProperty(prop) {
    const agent = isRecord(prop.agent) ? prop.agent : undefined;
    return (0, contact_1.buildContact)({
        phone: agent
            ? asString(agent.telephone) ?? asString(agent.telephoneEnquiries)
            : undefined,
        whatsapp: asString(prop.whatsappLink),
        agencyName: agent
            ? asString(agent.name) ?? asString(agent.companyName)
            : undefined,
        kind: 'agency',
    });
}
function priceAmountFromProperty(prop) {
    // For lettings priceRaw is monthly when shortPrice is pcm; for garages it can be weekly.
    const priceText = asString(prop.price) ?? asString(prop.shortPrice) ?? '';
    const pcm = priceText.match(/£([\d,]+)\s*pcm/i);
    if (pcm?.[1])
        return asNumber(pcm[1]);
    const raw = asNumber(prop.priceRaw);
    if (raw !== undefined && /pcm/i.test(priceText))
        return raw;
    if (raw !== undefined && !/pw\b/i.test(priceText))
        return raw;
    return asNumber(prop.priceRaw);
}
/** Parse detail `__NEXT_DATA__` redux property JSON. */
function parseOnTheMarketDetail(html, url) {
    const match = NEXT_DATA_RE.exec(html);
    if (!match?.[1]) {
        throw new Error(`onthemarket: no __NEXT_DATA__ at ${url}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(match[1]);
    }
    catch {
        throw new Error(`onthemarket: invalid __NEXT_DATA__ at ${url}`);
    }
    const props = isRecord(parsed) ? parsed.props : undefined;
    const redux = isRecord(props) ? props.initialReduxState : undefined;
    const prop = isRecord(redux) && isRecord(redux.property) ? redux.property : undefined;
    if (!prop) {
        throw new Error(`onthemarket: missing property redux state at ${url}`);
    }
    const propSubId = asString(prop.propSubId);
    const humanised = asString(prop.humanisedPropertyType);
    if (!(0, housing_1.isOtmHousingPropSubId)(propSubId) || !(0, housing_1.isGbHousingType)(humanised)) {
        throw new Error(`onthemarket: non-housing listing rejected at ${url}`);
    }
    const sourceId = asString(prop.id) ??
        (asNumber(prop.id) !== undefined ? String(Math.trunc(asNumber(prop.id))) : undefined) ??
        onthemarketSourceIdFromUrl(url);
    if (!sourceId) {
        throw new Error(`onthemarket: missing listing id at ${url}`);
    }
    const location = isRecord(prop.location) ? prop.location : undefined;
    const toRent = prop.toRent === true || asString(prop.searchType) === 'to-rent';
    const descriptionHtml = asString(prop.description);
    const description = descriptionHtml
        ? descriptionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : asString(prop.summary);
    return {
        sourceId,
        url: onthemarketDetailUrl(sourceId),
        kind: toRent ? 'rent' : 'sale',
        displayAddress: asString(prop.displayAddress),
        addressLocality: asString(prop.addressLocality),
        summary: asString(prop.summary),
        description,
        bedrooms: asNumber(prop.bedrooms),
        bathrooms: asNumber(prop.bathrooms),
        propertyType: humanised,
        propSubId,
        priceAmount: priceAmountFromProperty(prop),
        priceCurrency: 'GBP',
        latitude: location ? asNumber(location.lat) : undefined,
        longitude: location ? asNumber(location.lon) : undefined,
        images: imagesFromProperty(prop),
        contact: contactFromProperty(prop),
    };
}
