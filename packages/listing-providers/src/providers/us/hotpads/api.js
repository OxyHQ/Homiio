"use strict";
/**
 * HotPads public JSON API helpers (pure URL building + response parsing).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hotpadsAreaUrl = hotpadsAreaUrl;
exports.hotpadsListingsUrl = hotpadsListingsUrl;
exports.hotpadsSourceUrl = hotpadsSourceUrl;
exports.parseHotpadsArea = parseHotpadsArea;
exports.parseHotpadsSearch = parseHotpadsSearch;
exports.parseHotpadsListingById = parseHotpadsListingById;
exports.isHotpadsApiChallenge = isHotpadsApiChallenge;
const fixtures_1 = require("./fixtures");
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    return undefined;
}
function hotpadsAreaUrl(resourceId) {
    return `${fixtures_1.HOTPADS_API_BASE}/area/byResourceId?resourceId=${encodeURIComponent(resourceId)}`;
}
function hotpadsListingsUrl(area, limit = 200) {
    const params = new URLSearchParams({
        areas: area.id,
        minLat: String(area.minLat),
        maxLat: String(area.maxLat),
        minLon: String(area.minLon),
        maxLon: String(area.maxLon),
        searchSlug: 'apartments-for-rent',
        listingTypes: 'rental,room,sublet,corporate',
        propertyTypes: 'condo,divided,garden,house,large,medium,townhouse',
        orderBy: 'score',
        limit: String(limit),
        components: 'basic,useritem,quality,model,photos',
        trimResponse: 'true',
    });
    return `${fixtures_1.HOTPADS_API_BASE}/listing/byCoordsV2?${params.toString()}`;
}
function hotpadsSourceUrl(uriMalone) {
    const path = uriMalone.startsWith('/') ? uriMalone : `/${uriMalone}`;
    return `${fixtures_1.HOTPADS_BASE_URL}${path}`;
}
/** Parse area/byResourceId JSON into a {@link HotpadsArea}. */
function parseHotpadsArea(body) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || !isRecord(parsed.data))
        return undefined;
    const d = parsed.data;
    const id = asString(d.id);
    const resourceId = asString(d.resourceId);
    const name = asString(d.name);
    const state = asString(d.state);
    const city = asString(d.city);
    const minLat = asNumber(d.minLat);
    const maxLat = asNumber(d.maxLat);
    const minLon = asNumber(d.minLon);
    const maxLon = asNumber(d.maxLon);
    if (!id || !resourceId || !name || !state || !city)
        return undefined;
    if (minLat === undefined || maxLat === undefined || minLon === undefined || maxLon === undefined) {
        return undefined;
    }
    return { id, resourceId, name, state, city, minLat, maxLat, minLon, maxLon };
}
function readModelSummary(value) {
    if (!isRecord(value))
        return undefined;
    const minBeds = asNumber(value.minBeds);
    const maxBeds = asNumber(value.maxBeds);
    const minPrice = asNumber(value.minPrice);
    const maxPrice = asNumber(value.maxPrice);
    const minBaths = asNumber(value.minBaths);
    const maxBaths = asNumber(value.maxBaths);
    const minSqft = asNumber(value.minSqft);
    const maxSqft = asNumber(value.maxSqft);
    if (minBeds === undefined ||
        maxBeds === undefined ||
        minPrice === undefined ||
        maxPrice === undefined ||
        minBaths === undefined ||
        maxBaths === undefined ||
        minSqft === undefined ||
        maxSqft === undefined) {
        return undefined;
    }
    return { minBeds, maxBeds, minPrice, maxPrice, minBaths, maxBaths, minSqft, maxSqft };
}
function readListingNode(listing, lotIdEncoded, buildingGeo) {
    const aliasEncoded = asString(listing.aliasEncoded);
    const uriMalone = asString(listing.uriMalone);
    const title = asString(listing.title);
    const propertyType = asString(listing.propertyType);
    const listingType = asString(listing.listingType);
    const addressRaw = isRecord(listing.address) ? listing.address : null;
    const geoRaw = isRecord(listing.geo) ? listing.geo : buildingGeo;
    const modelSummary = readModelSummary(listing.modelSummary);
    if (!aliasEncoded || !uriMalone || !title || !propertyType || !listingType || !addressRaw || !geoRaw || !modelSummary) {
        return undefined;
    }
    const street = asString(addressRaw.street);
    const city = asString(addressRaw.city);
    const state = asString(addressRaw.state);
    const zip = asString(addressRaw.zip);
    const lat = asNumber(geoRaw.lat);
    const lon = asNumber(geoRaw.lon);
    if (!street || !city || !state || !zip || lat === undefined || lon === undefined)
        return undefined;
    const medPhotoUrl = asString(listing.medPhotoUrl) ?? '';
    const medPhotoUrls = [];
    if (Array.isArray(listing.medPhotoUrls)) {
        for (const entry of listing.medPhotoUrls) {
            const url = asString(entry);
            if (url)
                medPhotoUrls.push(url);
        }
    }
    return {
        aliasEncoded,
        lotIdEncoded,
        uriMalone,
        title,
        propertyType,
        listingType,
        address: { street, city, state, zip },
        geo: { lat, lon },
        modelSummary,
        medPhotoUrl,
        medPhotoUrls,
    };
}
/** Parse byCoordsV2 JSON into listing refs. */
function parseHotpadsSearch(body) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        return [];
    }
    if (!isRecord(parsed) || !isRecord(parsed.data) || !Array.isArray(parsed.data.buildings))
        return [];
    const out = [];
    for (const building of parsed.data.buildings) {
        if (!isRecord(building))
            continue;
        const lotIdEncoded = asString(building.lotIdEncoded) ?? '';
        const buildingGeo = isRecord(building.geo) ? building.geo : undefined;
        const listings = building.listings;
        if (!Array.isArray(listings))
            continue;
        for (const entry of listings) {
            if (!isRecord(entry))
                continue;
            const listing = readListingNode(entry, lotIdEncoded, buildingGeo);
            if (!listing)
                continue;
            out.push({
                sourceId: listing.aliasEncoded,
                url: hotpadsSourceUrl(listing.uriMalone),
                lotIdEncoded: listing.lotIdEncoded,
            });
        }
    }
    return out;
}
/** Find one listing node in a byCoordsV2 body by alias/source id. */
function parseHotpadsListingById(body, sourceId) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || !isRecord(parsed.data) || !Array.isArray(parsed.data.buildings))
        return undefined;
    for (const building of parsed.data.buildings) {
        if (!isRecord(building))
            continue;
        const lotIdEncoded = asString(building.lotIdEncoded) ?? '';
        const buildingGeo = isRecord(building.geo) ? building.geo : undefined;
        const listings = building.listings;
        if (!Array.isArray(listings))
            continue;
        for (const entry of listings) {
            if (!isRecord(entry))
                continue;
            const listing = readListingNode(entry, lotIdEncoded, buildingGeo);
            if (listing?.aliasEncoded === sourceId)
                return listing;
        }
    }
    return undefined;
}
function isHotpadsApiChallenge(body) {
    const trimmed = body.trim();
    if (trimmed.length === 0)
        return true;
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed.success === false)
            return true;
        if (typeof parsed.status === 'string' && parsed.status !== 'OK')
            return true;
        return false;
    }
    catch {
        return true;
    }
}
