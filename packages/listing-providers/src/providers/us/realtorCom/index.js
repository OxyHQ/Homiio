"use strict";
/**
 * realtor.com provider (United States).
 *
 * realtor.com exposes an internal GraphQL API at `/frontdoor/graphql` that powers
 * search and detail pages. This plugin uses direct JSON POST (no HTML scrape) for
 * discover + fetch; the shared {@link FetchRuntime} supplies `fetchHttp` only.
 * Registered OFF by default (`PROVIDER_REALTOR_COM_ENABLED`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRealtorListingNode = exports.parseRealtorDetailResponse = exports.parseRealtorSearchResponse = exports.RealtorComProvider = void 0;
const shared_types_1 = require("@homiio/shared-types");
const runtime_1 = require("../../../runtime");
const metrics_1 = require("../../../metrics");
const portals_1 = require("../portals");
const api_1 = require("./api");
Object.defineProperty(exports, "parseRealtorDetailResponse", { enumerable: true, get: function () { return api_1.parseRealtorDetailResponse; } });
Object.defineProperty(exports, "parseRealtorListingNode", { enumerable: true, get: function () { return api_1.parseRealtorListingNode; } });
Object.defineProperty(exports, "parseRealtorSearchResponse", { enumerable: true, get: function () { return api_1.parseRealtorSearchResponse; } });
const fixtures_1 = require("./fixtures");
const PROVIDER_ID = 'realtor_com';
const CURRENCY = 'USD';
const COUNTRY = 'United States';
const SEARCH_PAGE_SIZE = 42;
const MAX_SEARCH_PAGES = 3;
function refKind(ref) {
    return ref.hints?.kind === 'sale' ? 'sale' : 'rent';
}
function resolvePropertyType(kind) {
    return kind === 'sale' ? shared_types_1.PropertyType.HOUSE : shared_types_1.PropertyType.APARTMENT;
}
function resolveMonthlyAmount(listing) {
    if (listing.list_price !== null && listing.list_price > 0)
        return listing.list_price;
    if (listing.list_price_min !== null && listing.list_price_min > 0)
        return listing.list_price_min;
    return undefined;
}
function resolveSalePrice(listing) {
    if (listing.list_price !== null && listing.list_price > 0)
        return listing.list_price;
    return undefined;
}
function toRemoteImages(listing) {
    const urls = listing.photos.map((photo) => photo.href);
    const primary = listing.primary_photo?.href;
    const ordered = primary ? [primary, ...urls.filter((url) => url !== primary)] : urls;
    return [...new Set(ordered)].map((url, index) => ({ url, isPrimary: index === 0 }));
}
function buildAddress(listing) {
    const addr = listing.location.address;
    return {
        street: addr.line,
        city: addr.city,
        state: addr.state_code,
        country: COUNTRY,
        countryCode: 'US',
        postalCode: addr.postal_code,
        coordinates: { lat: addr.coordinate.lat, lng: addr.coordinate.lon },
    };
}
function asRealtorComRaw(payload) {
    const record = payload;
    if (!record ||
        typeof record.sourceId !== 'string' ||
        typeof record.url !== 'string' ||
        (record.kind !== 'rent' && record.kind !== 'sale') ||
        typeof record.listing !== 'object' ||
        record.listing === null) {
        throw new Error('realtor_com provider received a payload that is not a RealtorComRaw');
    }
    return payload;
}
async function postGraphql(runtime, body, signal) {
    const { status, body: responseBody } = await runtime.fetchHttp(api_1.REALTOR_GRAPHQL_URL, {
        signal,
        method: 'POST',
        body,
        headers: {
            ...api_1.REALTOR_GRAPHQL_HEADERS,
            Accept: 'application/json',
        },
    });
    if (status >= 400 || (0, api_1.isRealtorGraphqlChallenge)(responseBody)) {
        throw new Error(`realtor_com GraphQL failed (HTTP ${status})`);
    }
    return responseBody;
}
class RealtorComProvider {
    constructor(options = {}) {
        this.id = PROVIDER_ID;
        this.markets = ['US'];
        this.runtime = options.runtime ?? (0, runtime_1.createFetchRuntime)();
        this.metrics = options.metrics ?? metrics_1.defaultProviderMetrics;
        this.cities = options.cities && options.cities.length > 0 ? options.cities : portals_1.DEFAULT_US_CITIES;
    }
    async *discover(job) {
        const cities = job.city ? [job.city] : this.cities;
        const limit = job.limit ?? Number.POSITIVE_INFINITY;
        const runtime = job.runtime ?? this.runtime;
        const seen = new Set();
        let yielded = 0;
        for (const city of cities) {
            for (const kind of ['rent', 'sale']) {
                for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
                    if (yielded >= limit)
                        return;
                    const offset = page * SEARCH_PAGE_SIZE;
                    const start = Date.now();
                    let body;
                    try {
                        body = await postGraphql(runtime, (0, api_1.realtorSearchBody)(city, kind, offset, SEARCH_PAGE_SIZE), job.signal);
                    }
                    catch (error) {
                        this.metrics.record({
                            provider: this.id,
                            strategy: 'http',
                            outcome: 'error',
                            status: 0,
                            latencyMs: Date.now() - start,
                            url: api_1.REALTOR_GRAPHQL_URL,
                            detail: error instanceof Error ? error.message : String(error),
                        });
                        break;
                    }
                    const refs = (0, api_1.parseRealtorSearchResponse)(body);
                    this.metrics.record({
                        provider: this.id,
                        strategy: 'http',
                        outcome: refs.length > 0 ? 'success' : 'error',
                        status: 200,
                        latencyMs: Date.now() - start,
                        url: api_1.REALTOR_GRAPHQL_URL,
                    });
                    if (refs.length === 0)
                        break;
                    for (const ref of refs) {
                        if (yielded >= limit)
                            return;
                        if (seen.has(ref.sourceId))
                            continue;
                        seen.add(ref.sourceId);
                        yield {
                            provider: this.id,
                            sourceId: ref.sourceId,
                            url: ref.url,
                            hints: { kind: ref.kind },
                        };
                        yielded += 1;
                    }
                }
            }
        }
    }
    async fetch(ref, ctx) {
        const start = Date.now();
        const body = await postGraphql(ctx.runtime, (0, api_1.realtorDetailBody)(ref.sourceId), ctx.signal);
        const listing = (0, api_1.parseRealtorDetailResponse)(body);
        if (!listing) {
            this.metrics.record({
                provider: this.id,
                strategy: 'http',
                outcome: 'error',
                status: 200,
                latencyMs: Date.now() - start,
                url: api_1.REALTOR_GRAPHQL_URL,
                detail: 'HomeDetails returned no listing',
            });
            throw new Error(`realtor_com: no listing found for property_id ${ref.sourceId}`);
        }
        this.metrics.record({
            provider: this.id,
            strategy: 'http',
            outcome: 'success',
            status: 200,
            latencyMs: Date.now() - start,
            url: api_1.REALTOR_GRAPHQL_URL,
        });
        const kind = refKind(ref);
        return {
            ref,
            payload: {
                sourceId: ref.sourceId,
                url: (0, api_1.realtorSourceUrl)(listing.permalink),
                kind,
                listing,
            },
        };
    }
    normalize(raw) {
        const { sourceId, url, kind, listing } = asRealtorComRaw(raw.payload);
        const resolvedKind = kind ?? (0, api_1.realtorKindFromStatus)(listing.status);
        const result = {
            source: this.id,
            sourceId,
            sourceUrl: url,
            address: buildAddress(listing),
            type: resolvePropertyType(resolvedKind),
            offerings: resolvedKind === 'sale' ? [shared_types_1.OfferingType.SALE] : [shared_types_1.OfferingType.LONG_TERM_RENT],
            remoteImages: toRemoteImages(listing),
            status: 'published',
        };
        if (resolvedKind === 'sale') {
            const price = resolveSalePrice(listing);
            if (price === undefined) {
                throw new Error(`realtor_com: listing ${sourceId} has no resolvable sale price`);
            }
            result.sale = { price, currency: CURRENCY };
        }
        else {
            const monthlyAmount = resolveMonthlyAmount(listing);
            if (monthlyAmount === undefined) {
                throw new Error(`realtor_com: listing ${sourceId} has no resolvable rent price`);
            }
            result.longTermRent = { monthlyAmount, currency: CURRENCY };
        }
        if (listing.description.beds !== null)
            result.bedrooms = listing.description.beds;
        if (listing.description.baths !== null)
            result.bathrooms = listing.description.baths;
        if (listing.description.sqft !== null)
            result.squareFootage = listing.description.sqft;
        return result;
    }
    async health() {
        return {
            provider: this.id,
            status: 'healthy',
            detail: `Serving ${this.markets.join(', ')} via ${fixtures_1.REALTOR_COM_BASE_URL} GraphQL`,
        };
    }
}
exports.RealtorComProvider = RealtorComProvider;
