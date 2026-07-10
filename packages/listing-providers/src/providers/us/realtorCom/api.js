"use strict";
/**
 * realtor.com GraphQL API helpers (pure URL + response parsing).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REALTOR_GRAPHQL_HEADERS = exports.REALTOR_GRAPHQL_URL = void 0;
exports.realtorKindFromStatus = realtorKindFromStatus;
exports.realtorSourceUrl = realtorSourceUrl;
exports.realtorSearchBody = realtorSearchBody;
exports.realtorDetailBody = realtorDetailBody;
exports.parseRealtorListingNode = parseRealtorListingNode;
exports.parseRealtorSearchResponse = parseRealtorSearchResponse;
exports.parseRealtorDetailResponse = parseRealtorDetailResponse;
exports.isRealtorGraphqlChallenge = isRealtorGraphqlChallenge;
const fixtures_1 = require("./fixtures");
exports.REALTOR_GRAPHQL_URL = 'https://www.realtor.com/frontdoor/graphql?client_id=rdc-x&schema=vesta';
exports.REALTOR_GRAPHQL_HEADERS = {
    'content-type': 'application/json',
    'rdc-client-name': 'RDC_WEB',
    'rdc-client-version': '3.0.0',
};
const SEARCH_QUERY = `query ConsumerSearchMainQuery($query: HomeSearchCriteria!, $limit: Int, $offset: Int, $sort_type: SearchSortType) {
  home_search: home_search(query: $query, limit: $limit, offset: $offset, sort_type: $sort_type) {
    count
    total
    results {
      property_id
      listing_id
      permalink
      status
      list_price
      list_price_min
      list_price_max
      description { beds baths sqft }
      location {
        address {
          line
          city
          state_code
          postal_code
          coordinate { lat lon }
        }
      }
      primary_photo { href }
      photos { href }
    }
  }
}`;
const DETAIL_QUERY = `query HomeDetails($property_id: ID!) {
  home(property_id: $property_id) {
    property_id
    listing_id
    permalink
    status
    list_price
    list_price_min
    list_price_max
    description { beds baths sqft }
    location {
      address {
        line
        city
        state_code
        postal_code
        coordinate { lat lon }
      }
    }
    primary_photo { href }
    photos { href }
  }
}`;
function statusForKind(kind) {
    return kind === 'sale' ? ['for_sale'] : ['for_rent'];
}
function realtorKindFromStatus(status) {
    return status === 'for_sale' ? 'sale' : 'rent';
}
function realtorSourceUrl(permalink) {
    return `${fixtures_1.REALTOR_COM_BASE_URL}/realestateandhomes-detail/${permalink}`;
}
function realtorSearchBody(city, kind, offset, limit) {
    return JSON.stringify({
        operationName: 'ConsumerSearchMainQuery',
        query: SEARCH_QUERY,
        variables: {
            query: {
                status: statusForKind(kind),
                search_location: { location: city },
            },
            limit,
            offset,
            sort_type: 'relevant',
        },
    });
}
function realtorDetailBody(propertyId) {
    return JSON.stringify({
        operationName: 'HomeDetails',
        query: DETAIL_QUERY,
        variables: { property_id: propertyId },
    });
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    return undefined;
}
function asString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
function readCoordinate(value) {
    if (!isRecord(value))
        return undefined;
    const lat = asNumber(value.lat);
    const lon = asNumber(value.lon);
    if (lat === undefined || lon === undefined)
        return undefined;
    return { lat, lon };
}
function readPhotos(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const entry of value) {
        if (!isRecord(entry))
            continue;
        const href = asString(entry.href);
        if (href)
            out.push({ href });
    }
    return out;
}
/** Narrow a GraphQL home node into {@link RecordedRealtorListing}. */
function parseRealtorListingNode(node) {
    if (!isRecord(node))
        return undefined;
    const property_id = asString(node.property_id);
    const listing_id = asString(node.listing_id);
    const permalink = asString(node.permalink);
    const status = asString(node.status);
    if (!property_id || !listing_id || !permalink || !status)
        return undefined;
    const descriptionRaw = isRecord(node.description) ? node.description : {};
    const locationRaw = isRecord(node.location) && isRecord(node.location.address) ? node.location.address : null;
    if (!locationRaw)
        return undefined;
    const line = asString(locationRaw.line);
    const city = asString(locationRaw.city);
    const state_code = asString(locationRaw.state_code);
    const postal_code = asString(locationRaw.postal_code);
    const coordinate = readCoordinate(locationRaw.coordinate);
    if (!line || !city || !state_code || !postal_code || !coordinate)
        return undefined;
    const primaryRaw = isRecord(node.primary_photo) ? node.primary_photo : null;
    const primaryHref = primaryRaw ? asString(primaryRaw.href) : undefined;
    return {
        property_id,
        listing_id,
        permalink,
        status,
        list_price: asNumber(node.list_price) ?? null,
        list_price_min: asNumber(node.list_price_min) ?? null,
        list_price_max: asNumber(node.list_price_max) ?? null,
        description: {
            beds: asNumber(descriptionRaw.beds) ?? null,
            baths: asNumber(descriptionRaw.baths) ?? null,
            sqft: asNumber(descriptionRaw.sqft) ?? null,
        },
        location: {
            address: { line, city, state_code, postal_code, coordinate },
        },
        photos: readPhotos(node.photos),
        primary_photo: primaryHref ? { href: primaryHref } : null,
    };
}
/** Parse a ConsumerSearchMainQuery JSON body into listing refs. */
function parseRealtorSearchResponse(body) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        return [];
    }
    if (!isRecord(parsed) || !isRecord(parsed.data) || !isRecord(parsed.data.home_search))
        return [];
    const results = parsed.data.home_search.results;
    if (!Array.isArray(results))
        return [];
    const out = [];
    for (const entry of results) {
        const listing = parseRealtorListingNode(entry);
        if (!listing)
            continue;
        const kind = realtorKindFromStatus(listing.status);
        out.push({
            sourceId: listing.property_id,
            url: realtorSourceUrl(listing.permalink),
            kind,
        });
    }
    return out;
}
/** Parse a HomeDetails JSON body into a listing node. */
function parseRealtorDetailResponse(body) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || !isRecord(parsed.data) || !isRecord(parsed.data.home))
        return undefined;
    return parseRealtorListingNode(parsed.data.home);
}
/** GraphQL error / rate-limit bodies served as JSON. */
function isRealtorGraphqlChallenge(body) {
    const trimmed = body.trim();
    if (trimmed.length === 0)
        return true;
    if (!trimmed.startsWith('{'))
        return true;
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed.errors) && parsed.errors.length > 0)
            return true;
        if (typeof parsed.message === 'string' && /missing client|denied|blocked/i.test(parsed.message))
            return true;
        return false;
    }
    catch {
        return true;
    }
}
