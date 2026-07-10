"use strict";
/**
 * Redfin Stingray API helpers (pure URL building + JSON parsing).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REDFIN_CONTENT_SELECTOR = exports.REDFIN_CITY_REGIONS = void 0;
exports.redfinWarmUrl = redfinWarmUrl;
exports.redfinGisUrl = redfinGisUrl;
exports.redfinInitialInfoUrl = redfinInitialInfoUrl;
exports.redfinSourceUrl = redfinSourceUrl;
exports.redfinSourceId = redfinSourceId;
exports.parseRedfinHomeNode = parseRedfinHomeNode;
exports.redfinKindFromHome = redfinKindFromHome;
exports.parseRedfinGisResponse = parseRedfinGisResponse;
exports.parseRedfinDetailResponse = parseRedfinDetailResponse;
exports.isRedfinStingrayChallenge = isRedfinStingrayChallenge;
const portals_1 = require("../portals");
const fixtures_1 = require("./fixtures");
/** Known Redfin `region_id` values for default US discover cities. */
exports.REDFIN_CITY_REGIONS = {
    'austin-tx': { regionId: 30749, path: '/city/30749/TX/Austin' },
    'new-york-ny': { regionId: 42866, path: '/city/42866/NY/New-York' },
    'los-angeles-ca': { regionId: 11203, path: '/city/11203/CA/Los-Angeles' },
    'chicago-il': { regionId: 17426, path: '/city/17426/IL/Chicago' },
    'miami-fl': { regionId: 11458, path: '/city/11458/FL/Miami' },
};
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
function readNestedNumber(value) {
    if (!isRecord(value))
        return asNumber(value);
    return asNumber(value.value);
}
function readNestedString(value) {
    if (!isRecord(value))
        return asString(value);
    return asString(value.value);
}
function readLatLng(value) {
    if (!isRecord(value))
        return undefined;
    const nested = isRecord(value.value) ? value.value : value;
    const lat = asNumber(nested.latitude);
    const lng = asNumber(nested.longitude);
    if (lat === undefined || lng === undefined)
        return undefined;
    return { lat, lng };
}
function readPhotoUrls(value) {
    if (!isRecord(value) || !Array.isArray(value.value))
        return [];
    const out = [];
    for (const entry of value.value) {
        if (!isRecord(entry))
            continue;
        const url = asString(entry.url);
        if (url)
            out.push(url);
    }
    return out;
}
function isRentalHome(home) {
    const sashes = home.sashes;
    if (!Array.isArray(sashes))
        return false;
    return sashes.some((entry) => {
        if (!isRecord(entry))
            return false;
        const name = asString(entry.sashTypeName);
        return name?.toLowerCase().includes('rental') ?? false;
    });
}
function redfinWarmUrl(citySlug) {
    const region = exports.REDFIN_CITY_REGIONS[citySlug];
    if (!region)
        return `${fixtures_1.REDFIN_BASE_URL}/`;
    return `${fixtures_1.REDFIN_BASE_URL}${region.path}`;
}
function redfinGisUrl(regionId, pageNumber, numHomes) {
    const params = new URLSearchParams({
        al: '3',
        include_nearby_homes: 'true',
        mpt: '99',
        num_homes: String(numHomes),
        ord: 'redfin-recommended-asc',
        page_number: String(pageNumber),
        region_id: String(regionId),
        region_type: '6',
        status: '9',
        uipt: '1,2,3,4,5,6,7,8',
        v: '8',
    });
    return `${fixtures_1.REDFIN_BASE_URL}/stingray/api/gis?${params.toString()}`;
}
function redfinInitialInfoUrl(homePath) {
    const path = homePath.startsWith('/') ? homePath.slice(1) : homePath;
    return `${fixtures_1.REDFIN_BASE_URL}/stingray/api/home/details/initialInfo?path=${encodeURIComponent(path)}`;
}
function redfinSourceUrl(homePath) {
    const path = homePath.startsWith('/') ? homePath : `/${homePath}`;
    return `${fixtures_1.REDFIN_BASE_URL}${path}`;
}
function redfinSourceId(propertyId) {
    return String(propertyId);
}
/** Parse one Stingray home row into {@link RedfinHomeFixture}. */
function parseRedfinHomeNode(home) {
    if (!isRecord(home))
        return undefined;
    const propertyId = asNumber(home.propertyId);
    const listingId = asNumber(home.listingId);
    const url = asString(home.url);
    const price = readNestedNumber(home.price);
    const beds = asNumber(home.beds);
    const baths = asNumber(home.baths);
    const sqFt = readNestedNumber(home.sqFt);
    const street = readNestedString(home.streetLine);
    const city = asString(home.city);
    const state = asString(home.state);
    const zip = asString(home.zip);
    const coords = readLatLng(home.latLong);
    if (propertyId === undefined ||
        listingId === undefined ||
        !url ||
        price === undefined ||
        beds === undefined ||
        baths === undefined ||
        sqFt === undefined ||
        !street ||
        !city ||
        !state ||
        !zip ||
        !coords) {
        return undefined;
    }
    return {
        propertyId,
        listingId,
        url,
        price,
        beds,
        baths,
        sqFt,
        street,
        city,
        state,
        zip,
        lat: coords.lat,
        lng: coords.lng,
        photoUrls: readPhotoUrls(home.photos),
    };
}
function redfinKindFromHome(home) {
    return isRentalHome(home) ? 'rent' : 'sale';
}
/** Parse a Stingray GIS body into listing refs. */
function parseRedfinGisResponse(body) {
    const trimmed = (0, portals_1.stripStingrayPrefix)(body);
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        return [];
    }
    if (!isRecord(parsed) || !isRecord(parsed.payload) || !Array.isArray(parsed.payload.homes))
        return [];
    const out = [];
    for (const entry of parsed.payload.homes) {
        if (!isRecord(entry))
            continue;
        const propertyId = asNumber(entry.propertyId);
        const url = asString(entry.url);
        if (propertyId === undefined || !url)
            continue;
        out.push({
            sourceId: redfinSourceId(propertyId),
            url: redfinSourceUrl(url),
            kind: redfinKindFromHome(entry),
            homePath: url,
        });
    }
    return out;
}
/** Parse initialInfo / GIS single-home payload. */
function parseRedfinDetailResponse(body) {
    const trimmed = (0, portals_1.stripStingrayPrefix)(body);
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed))
        return undefined;
    if (isRecord(parsed.payload))
        return parseRedfinHomeNode(parsed.payload);
    return parseRedfinHomeNode(parsed);
}
function isRedfinStingrayChallenge(body) {
    const trimmed = (0, portals_1.stripStingrayPrefix)(body);
    if (!trimmed.startsWith('{'))
        return true;
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.resultCode === 'number' && parsed.resultCode !== 0)
            return true;
        if (typeof parsed.errorMessage === 'string' && parsed.errorMessage.length > 0)
            return true;
        return false;
    }
    catch {
        return true;
    }
}
/** CSS selector for Redfin city search warm-up. */
exports.REDFIN_CONTENT_SELECTOR = '#results-display, .HomeCardsContainer, .MapAndListViewSection';
