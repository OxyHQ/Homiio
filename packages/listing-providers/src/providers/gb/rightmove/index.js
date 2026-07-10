"use strict";
/**
 * Rightmove provider (United Kingdom).
 *
 * Acquisition order (JSON-first):
 *   1. Typeahead JSON (`los.rightmove.co.uk/typeahead`) → locationIdentifier
 *   2. Warm Playwright session on city search (optional) OR ladder HTML
 *   3. Parse `__NEXT_DATA__.searchResults.properties` JSON (housing-only)
 *   4. Detail: parse `window.__PAGE_MODEL` compressed JSON (contact + images)
 *
 * Registered OFF by default (`PROVIDER_RIGHTMOVE_ENABLED`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rightmoveSourceIdFromUrl = exports.RightmoveProvider = void 0;
exports.isRightmoveChallenge = isRightmoveChallenge;
const shared_types_1 = require("@homiio/shared-types");
const browserSession_1 = require("../../../browserSession");
const proxy_1 = require("../../../proxy");
const runtime_1 = require("../../../runtime");
const strategy_1 = require("../../../strategy");
const metrics_1 = require("../../../metrics");
const challenge_1 = require("../challenge");
const housing_1 = require("../housing");
const fixtures_1 = require("./fixtures");
const parse_1 = require("./parse");
Object.defineProperty(exports, "rightmoveSourceIdFromUrl", { enumerable: true, get: function () { return parse_1.rightmoveSourceIdFromUrl; } });
const PROVIDER_ID = 'rightmove';
const DEFAULT_CITIES = ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Bristol'];
const MAX_SEARCH_PAGES = 3;
const RESULTS_PER_PAGE = 24;
const CONTENT_SELECTOR = 'script#__NEXT_DATA__, main, [data-test="propertyCard"]';
function isRightmoveChallenge(html) {
    return (0, challenge_1.isGbPortalChallenge)(html);
}
function asRightmoveRaw(payload) {
    const record = payload;
    if (!record ||
        typeof record.sourceId !== 'string' ||
        typeof record.url !== 'string' ||
        (record.kind !== 'rent' && record.kind !== 'sale')) {
        throw new Error('rightmove: normalize received a payload that is not a RightmoveListingJson');
    }
    return payload;
}
function splitAddress(displayAddress) {
    if (!displayAddress)
        return { street: '', city: '' };
    const parts = displayAddress.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0)
        return { street: '', city: '' };
    if (parts.length === 1)
        return { street: parts[0], city: parts[0] };
    // "Holland Street, London, SE1" — last token may be outcode-only; prefer named locality.
    const last = parts[parts.length - 1];
    const postcodeOnly = /^[A-Z]{1,2}\d[A-Z\d]?(?:\s*\d[A-Z]{2})?$/i.test(last);
    const postcodeMatch = last.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
    let city;
    let streetParts;
    if (postcodeMatch || postcodeOnly) {
        city = parts[parts.length - 2] ?? last;
        streetParts = parts.slice(0, Math.max(1, parts.length - 2));
    }
    else {
        city = last;
        streetParts = parts.slice(0, parts.length - 1);
    }
    return {
        street: streetParts.join(', ') || city,
        city,
        postalCode: postcodeMatch?.[1]?.toUpperCase() ?? (postcodeOnly ? last.toUpperCase() : undefined),
    };
}
function toRemoteImages(urls) {
    return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}
function buildAddress(listing) {
    const split = splitAddress(listing.displayAddress);
    const postalCode = listing.outcode && listing.incode
        ? `${listing.outcode} ${listing.incode}`
        : split.postalCode;
    const address = {
        street: split.street,
        city: split.city,
        country: 'United Kingdom',
        countryCode: listing.countryCode ?? 'GB',
        postalCode,
    };
    if (listing.latitude !== undefined && listing.longitude !== undefined) {
        address.coordinates = { lat: listing.latitude, lng: listing.longitude };
    }
    return address;
}
class RightmoveProvider {
    constructor(options = {}) {
        this.id = PROVIDER_ID;
        this.markets = ['GB'];
        this.locationCache = new Map();
        this.runtime = options.runtime ?? (0, runtime_1.createFetchRuntime)();
        this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
        this.metrics = options.metrics ?? metrics_1.defaultProviderMetrics;
    }
    async resolveLocationId(runtime, city, signal) {
        const key = city.toLowerCase();
        const cached = this.locationCache.get(key);
        if (cached)
            return cached;
        try {
            const { status, body } = await runtime.fetchHttp((0, parse_1.rightmoveTypeaheadUrl)(city), {
                signal,
                headers: {
                    Accept: 'application/json',
                    Referer: `${fixtures_1.RIGHTMOVE_BASE_URL}/`,
                },
            });
            if (status >= 400)
                return undefined;
            const locationId = (0, parse_1.parseRightmoveTypeahead)(body);
            if (locationId)
                this.locationCache.set(key, locationId);
            return locationId;
        }
        catch {
            return undefined;
        }
    }
    async *discover(job) {
        const cities = job.city ? [job.city] : this.cities;
        const limit = job.limit ?? Number.POSITIVE_INFINITY;
        const seen = new Set();
        let yielded = 0;
        const runtime = job.runtime ?? this.runtime;
        for (const city of cities) {
            if (yielded >= limit)
                return;
            const locationId = await this.resolveLocationId(runtime, city, job.signal);
            if (!locationId)
                continue;
            for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
                if (yielded >= limit)
                    return;
                const index = page * RESULTS_PER_PAGE;
                const searchUrl = (0, parse_1.rightmoveSearchUrl)(locationId, 'rent', index);
                let html;
                if (runtime.openBrowserSession) {
                    html = await this.fetchSearchViaSession(runtime, searchUrl, job.signal);
                }
                if (!html) {
                    try {
                        const result = await (0, strategy_1.fetchListingViaLadder)(runtime, searchUrl, {
                            provider: this.id,
                            isChallenge: isRightmoveChallenge,
                            metrics: this.metrics,
                            init: { signal: job.signal },
                        });
                        html = result.html;
                    }
                    catch (error) {
                        if (error instanceof strategy_1.ChallengeError)
                            return;
                        throw error;
                    }
                }
                const refs = (0, parse_1.parseRightmoveSearchJson)(html);
                if (refs.length === 0)
                    break;
                for (const ref of refs) {
                    if (yielded >= limit)
                        return;
                    if (seen.has(ref.sourceId))
                        continue;
                    seen.add(ref.sourceId);
                    yielded += 1;
                    yield {
                        provider: PROVIDER_ID,
                        sourceId: ref.sourceId,
                        url: ref.url,
                        hints: { kind: ref.kind },
                    };
                }
            }
        }
    }
    async fetchSearchViaSession(runtime, searchUrl, signal) {
        if (!runtime.openBrowserSession)
            return undefined;
        const sticky = (0, proxy_1.envBool)('LISTING_PROXY_STICKY', false);
        if (sticky && !this.stickyProxySessionId) {
            this.stickyProxySessionId = (0, proxy_1.createProxySessionId)();
        }
        let session;
        const start = Date.now();
        try {
            session = await runtime.openBrowserSession({
                warmUrl: searchUrl,
                signal,
                contentSelector: CONTENT_SELECTOR,
                isChallenge: isRightmoveChallenge,
                challengeWaitMs: 45000,
                stickyProxySession: sticky,
                proxySessionId: this.stickyProxySessionId,
                storageState: this.stickyStorageState,
                blockAssets: true,
            });
            const html = await session.content();
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'success',
                status: 200,
                latencyMs: Date.now() - start,
                url: searchUrl,
            });
            if (sticky)
                this.stickyStorageState = await session.exportStorageState();
            return html;
        }
        catch (error) {
            const detail = error instanceof browserSession_1.BrowserSessionChallengeError
                ? error.detail
                : error instanceof Error
                    ? error.message
                    : String(error);
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'challenge',
                latencyMs: Date.now() - start,
                url: searchUrl,
                detail,
            });
            return undefined;
        }
        finally {
            await session?.close();
        }
    }
    async fetch(ref, ctx) {
        if (ctx.runtime.openBrowserSession) {
            const fromSession = await this.fetchDetailViaSession(ref, ctx);
            if (fromSession)
                return fromSession;
        }
        const { html } = await (0, strategy_1.fetchListingViaLadder)(ctx.runtime, ref.url, {
            provider: this.id,
            isChallenge: isRightmoveChallenge,
            init: { signal: ctx.signal },
            metrics: this.metrics,
        });
        const payload = (0, parse_1.parseRightmoveDetail)(html, ref.url);
        return { ref, payload };
    }
    async fetchDetailViaSession(ref, ctx) {
        if (!ctx.runtime.openBrowserSession)
            return undefined;
        const sticky = (0, proxy_1.envBool)('LISTING_PROXY_STICKY', false);
        if (sticky && !this.stickyProxySessionId) {
            this.stickyProxySessionId = (0, proxy_1.createProxySessionId)();
        }
        let session;
        const start = Date.now();
        try {
            session = await ctx.runtime.openBrowserSession({
                warmUrl: ref.url,
                signal: ctx.signal,
                contentSelector: 'script, h1, main',
                isChallenge: isRightmoveChallenge,
                challengeWaitMs: 45000,
                stickyProxySession: sticky,
                proxySessionId: this.stickyProxySessionId,
                storageState: this.stickyStorageState,
                blockAssets: true,
            });
            const html = await session.content();
            if (isRightmoveChallenge(html)) {
                this.metrics.record({
                    provider: this.id,
                    strategy: 'browser',
                    outcome: 'challenge',
                    status: 200,
                    latencyMs: Date.now() - start,
                    url: ref.url,
                });
                return undefined;
            }
            const payload = (0, parse_1.parseRightmoveDetail)(html, ref.url);
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'success',
                status: 200,
                latencyMs: Date.now() - start,
                url: ref.url,
            });
            if (sticky)
                this.stickyStorageState = await session.exportStorageState();
            return { ref, payload };
        }
        catch {
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'error',
                latencyMs: Date.now() - start,
                url: ref.url,
                detail: 'detail session failed; falling back to ladder',
            });
            return undefined;
        }
        finally {
            await session?.close();
        }
    }
    normalize(raw) {
        const listing = asRightmoveRaw(raw.payload);
        if (listing.priceAmount === undefined) {
            throw new Error(`rightmove: listing ${listing.sourceId} has no resolvable price`);
        }
        const isSale = listing.kind === 'sale';
        const result = {
            source: this.id,
            sourceId: listing.sourceId,
            sourceUrl: listing.url,
            address: buildAddress(listing),
            type: (0, housing_1.resolveGbPropertyType)(listing.propertySubType),
            offerings: isSale ? [shared_types_1.OfferingType.SALE] : [shared_types_1.OfferingType.LONG_TERM_RENT],
            longTermRent: isSale ? undefined : { monthlyAmount: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' },
            sale: isSale ? { price: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' } : undefined,
            remoteImages: toRemoteImages(listing.images),
            status: 'published',
        };
        const description = listing.description ?? listing.summary;
        if (description)
            result.description = description;
        if (listing.bedrooms !== undefined)
            result.bedrooms = listing.bedrooms;
        if (listing.bathrooms !== undefined)
            result.bathrooms = listing.bathrooms;
        if (listing.contact)
            result.contact = listing.contact;
        return result;
    }
    async health() {
        const snapshot = this.metrics.snapshot(this.id);
        if (snapshot && snapshot.attempts > 0) {
            const status = snapshot.challengeRate >= 0.8 ? 'unhealthy' : snapshot.challengeRate >= 0.3 ? 'degraded' : 'healthy';
            return {
                provider: this.id,
                status,
                detail: `attempts=${snapshot.attempts} challengeRate=${snapshot.challengeRate.toFixed(2)} avgLatencyMs=${snapshot.avgLatencyMs}`,
            };
        }
        return {
            provider: this.id,
            status: 'healthy',
            detail: `Serving GB via ${fixtures_1.RIGHTMOVE_BASE_URL} (typeahead + __NEXT_DATA__/__PAGE_MODEL JSON)`,
        };
    }
}
exports.RightmoveProvider = RightmoveProvider;
