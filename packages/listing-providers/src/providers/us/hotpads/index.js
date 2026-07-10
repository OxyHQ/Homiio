"use strict";
/**
 * HotPads provider (United States).
 *
 * HotPads exposes a public JSON API (`hotpads-api-gke-prod-...hotpads.com`) that
 * powers its search UI — no auth, no PerimeterX on the API host. This plugin
 * uses direct HTTP JSON for discover + fetch. Registered OFF by default
 * (`PROVIDER_HOTPADS_ENABLED`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseHotpadsArea = exports.parseHotpadsListingById = exports.parseHotpadsSearch = exports.HotpadsProvider = void 0;
const shared_types_1 = require("@homiio/shared-types");
const runtime_1 = require("../../../runtime");
const metrics_1 = require("../../../metrics");
const portals_1 = require("../portals");
const api_1 = require("./api");
Object.defineProperty(exports, "parseHotpadsArea", { enumerable: true, get: function () { return api_1.parseHotpadsArea; } });
Object.defineProperty(exports, "parseHotpadsListingById", { enumerable: true, get: function () { return api_1.parseHotpadsListingById; } });
Object.defineProperty(exports, "parseHotpadsSearch", { enumerable: true, get: function () { return api_1.parseHotpadsSearch; } });
const fixtures_1 = require("./fixtures");
const PROVIDER_ID = 'hotpads';
const CURRENCY = 'USD';
const COUNTRY = 'United States';
const SEARCH_LIMIT = 200;
function resolvePropertyType(propertyType) {
    const lower = propertyType.toLowerCase();
    if (lower.includes('house') || lower.includes('town'))
        return shared_types_1.PropertyType.HOUSE;
    if (lower.includes('studio') || lower === 'divided')
        return shared_types_1.PropertyType.STUDIO;
    return shared_types_1.PropertyType.APARTMENT;
}
function toRemoteImages(listing) {
    const urls = [listing.medPhotoUrl, ...listing.medPhotoUrls].filter((url) => url.length > 0);
    return [...new Set(urls)].map((url, index) => ({ url, isPrimary: index === 0 }));
}
function buildAddress(listing) {
    return {
        street: listing.address.street,
        city: listing.address.city,
        state: listing.address.state,
        country: COUNTRY,
        countryCode: 'US',
        postalCode: listing.address.zip,
        coordinates: { lat: listing.geo.lat, lng: listing.geo.lon },
    };
}
function asHotpadsRaw(payload) {
    const record = payload;
    if (!record ||
        typeof record.sourceId !== 'string' ||
        typeof record.url !== 'string' ||
        typeof record.listing !== 'object' ||
        record.listing === null) {
        throw new Error('hotpads provider received a payload that is not a HotpadsRaw');
    }
    return payload;
}
async function fetchArea(runtime, city, signal) {
    const resourceId = (0, portals_1.cityToResourceSlug)(city);
    const { status, body } = await runtime.fetchHttp((0, api_1.hotpadsAreaUrl)(resourceId), { signal });
    if (status >= 400 || (0, api_1.isHotpadsApiChallenge)(body)) {
        throw new Error(`hotpads area lookup failed for ${city} (HTTP ${status})`);
    }
    const area = (0, api_1.parseHotpadsArea)(body);
    if (!area)
        throw new Error(`hotpads area lookup returned no data for ${city}`);
    return area;
}
class HotpadsProvider {
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
            if (yielded >= limit)
                return;
            const start = Date.now();
            let area;
            try {
                area = await fetchArea(runtime, city, job.signal);
            }
            catch (error) {
                this.metrics.record({
                    provider: this.id,
                    strategy: 'http',
                    outcome: 'error',
                    status: 0,
                    latencyMs: Date.now() - start,
                    url: (0, api_1.hotpadsAreaUrl)((0, portals_1.cityToResourceSlug)(city)),
                    detail: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
            const listUrl = (0, api_1.hotpadsListingsUrl)(area, SEARCH_LIMIT);
            const { status, body } = await runtime.fetchHttp(listUrl, { signal: job.signal });
            const refs = (0, api_1.parseHotpadsSearch)(body);
            this.metrics.record({
                provider: this.id,
                strategy: 'http',
                outcome: status < 400 && refs.length > 0 ? 'success' : 'error',
                status,
                latencyMs: Date.now() - start,
                url: listUrl,
            });
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
                    hints: { lotIdEncoded: ref.lotIdEncoded, city },
                };
                yielded += 1;
            }
        }
    }
    async fetch(ref, ctx) {
        const cityHint = typeof ref.hints?.city === 'string' ? ref.hints.city : undefined;
        const cities = cityHint ? [cityHint] : this.cities;
        const start = Date.now();
        for (const city of cities) {
            const area = await fetchArea(ctx.runtime, city, ctx.signal);
            const listUrl = (0, api_1.hotpadsListingsUrl)(area, SEARCH_LIMIT);
            const { status, body } = await ctx.runtime.fetchHttp(listUrl, { signal: ctx.signal });
            const listing = (0, api_1.parseHotpadsListingById)(body, ref.sourceId);
            if (listing) {
                this.metrics.record({
                    provider: this.id,
                    strategy: 'http',
                    outcome: 'success',
                    status,
                    latencyMs: Date.now() - start,
                    url: listUrl,
                });
                return {
                    ref,
                    payload: {
                        sourceId: ref.sourceId,
                        url: (0, api_1.hotpadsSourceUrl)(listing.uriMalone),
                        listing,
                    },
                };
            }
        }
        this.metrics.record({
            provider: this.id,
            strategy: 'http',
            outcome: 'error',
            status: 404,
            latencyMs: Date.now() - start,
            url: ref.url,
            detail: `listing ${ref.sourceId} not found in search refresh`,
        });
        throw new Error(`hotpads: listing ${ref.sourceId} not found in city search refresh`);
    }
    normalize(raw) {
        const { sourceId, url, listing } = asHotpadsRaw(raw.payload);
        const monthlyAmount = listing.modelSummary.minPrice;
        if (monthlyAmount <= 0) {
            throw new Error(`hotpads: listing ${sourceId} has no resolvable price`);
        }
        const result = {
            source: this.id,
            sourceId,
            sourceUrl: url,
            address: buildAddress(listing),
            type: resolvePropertyType(listing.propertyType),
            offerings: [shared_types_1.OfferingType.LONG_TERM_RENT],
            longTermRent: { monthlyAmount, currency: CURRENCY },
            remoteImages: toRemoteImages(listing),
            status: 'published',
            description: listing.title,
            bedrooms: listing.modelSummary.minBeds,
            bathrooms: listing.modelSummary.minBaths,
            squareFootage: listing.modelSummary.minSqft,
        };
        return result;
    }
    async health() {
        return {
            provider: this.id,
            status: 'healthy',
            detail: `Serving ${this.markets.join(', ')} via ${fixtures_1.HOTPADS_BASE_URL} JSON API`,
        };
    }
}
exports.HotpadsProvider = HotpadsProvider;
