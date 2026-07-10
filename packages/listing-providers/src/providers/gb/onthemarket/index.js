"use strict";
/**
 * OnTheMarket provider (United Kingdom).
 *
 * JSON-first: detail pages expose listing + agent contact in
 * `__NEXT_DATA__.props.initialReduxState.property`. Discover pages search HTML
 * for `/details/<id>` and rejects non-housing (garages/parking) at normalize.
 *
 * Registered OFF by default (`PROVIDER_ONTHEMARKET_ENABLED`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onthemarketSourceIdFromUrl = exports.OnTheMarketProvider = void 0;
exports.isOnTheMarketChallenge = isOnTheMarketChallenge;
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
Object.defineProperty(exports, "onthemarketSourceIdFromUrl", { enumerable: true, get: function () { return parse_1.onthemarketSourceIdFromUrl; } });
const PROVIDER_ID = 'onthemarket';
const DEFAULT_CITIES = ['london', 'manchester', 'birmingham', 'edinburgh', 'bristol'];
const MAX_SEARCH_PAGES = 3;
function isOnTheMarketChallenge(html) {
    return (0, challenge_1.isGbPortalChallenge)(html);
}
function asOtmRaw(payload) {
    const record = payload;
    if (!record ||
        typeof record.sourceId !== 'string' ||
        typeof record.url !== 'string' ||
        (record.kind !== 'rent' && record.kind !== 'sale')) {
        throw new Error('onthemarket: normalize received an invalid payload');
    }
    return payload;
}
function splitAddress(displayAddress, locality) {
    if (!displayAddress)
        return { street: '', city: locality ?? '' };
    const parts = displayAddress.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0)
        return { street: '', city: locality ?? '' };
    const last = parts[parts.length - 1];
    const postcodeMatch = last.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
    const city = locality ?? (postcodeMatch ? parts[parts.length - 2] ?? last : last);
    const street = parts.slice(0, Math.max(1, parts.length - 1)).join(', ');
    return { street: street || city, city, postalCode: postcodeMatch?.[1]?.toUpperCase() };
}
function toRemoteImages(urls) {
    return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}
function buildAddress(listing) {
    const split = splitAddress(listing.displayAddress, listing.addressLocality);
    const address = {
        street: split.street,
        city: split.city,
        country: 'United Kingdom',
        countryCode: 'GB',
        postalCode: split.postalCode,
    };
    if (listing.latitude !== undefined && listing.longitude !== undefined) {
        address.coordinates = { lat: listing.latitude, lng: listing.longitude };
    }
    return address;
}
class OnTheMarketProvider {
    constructor(options = {}) {
        this.id = PROVIDER_ID;
        this.markets = ['GB'];
        this.runtime = options.runtime ?? (0, runtime_1.createFetchRuntime)();
        this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
        this.metrics = options.metrics ?? metrics_1.defaultProviderMetrics;
    }
    async *discover(job) {
        const cities = job.city ? [job.city] : this.cities;
        const limit = job.limit ?? Number.POSITIVE_INFINITY;
        const seen = new Set();
        let yielded = 0;
        const runtime = job.runtime ?? this.runtime;
        for (const city of cities) {
            for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
                if (yielded >= limit)
                    return;
                const searchUrl = (0, parse_1.onthemarketSearchUrl)(city, page);
                let html;
                if (runtime.openBrowserSession) {
                    html = await this.fetchHtmlViaSession(runtime, searchUrl, job.signal);
                }
                if (!html) {
                    try {
                        const result = await (0, strategy_1.fetchListingViaLadder)(runtime, searchUrl, {
                            provider: this.id,
                            isChallenge: isOnTheMarketChallenge,
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
                const refs = (0, parse_1.parseOnTheMarketSearch)(html);
                if (refs.length === 0)
                    break;
                for (const ref of refs) {
                    if (yielded >= limit)
                        return;
                    if (seen.has(ref.sourceId))
                        continue;
                    seen.add(ref.sourceId);
                    yielded += 1;
                    yield { provider: PROVIDER_ID, sourceId: ref.sourceId, url: ref.url, hints: { kind: 'rent' } };
                }
            }
        }
    }
    async fetchHtmlViaSession(runtime, url, signal) {
        if (!runtime.openBrowserSession)
            return undefined;
        const sticky = (0, proxy_1.envBool)('LISTING_PROXY_STICKY', false);
        if (sticky && !this.stickyProxySessionId)
            this.stickyProxySessionId = (0, proxy_1.createProxySessionId)();
        let session;
        try {
            session = await runtime.openBrowserSession({
                warmUrl: url,
                signal,
                contentSelector: 'script#__NEXT_DATA__, a[href*="/details/"]',
                isChallenge: isOnTheMarketChallenge,
                challengeWaitMs: 45000,
                stickyProxySession: sticky,
                proxySessionId: this.stickyProxySessionId,
                storageState: this.stickyStorageState,
                blockAssets: true,
            });
            const html = await session.content();
            if (sticky)
                this.stickyStorageState = await session.exportStorageState();
            return html;
        }
        catch (error) {
            if (!(error instanceof browserSession_1.BrowserSessionChallengeError)) {
                // Fall through to ladder.
            }
            return undefined;
        }
        finally {
            await session?.close();
        }
    }
    async fetch(ref, ctx) {
        if (ctx.runtime.openBrowserSession) {
            const html = await this.fetchHtmlViaSession(ctx.runtime, ref.url, ctx.signal);
            if (html) {
                return { ref, payload: (0, parse_1.parseOnTheMarketDetail)(html, ref.url) };
            }
        }
        const { html } = await (0, strategy_1.fetchListingViaLadder)(ctx.runtime, ref.url, {
            provider: this.id,
            isChallenge: isOnTheMarketChallenge,
            init: { signal: ctx.signal },
            metrics: this.metrics,
        });
        return { ref, payload: (0, parse_1.parseOnTheMarketDetail)(html, ref.url) };
    }
    normalize(raw) {
        const listing = asOtmRaw(raw.payload);
        if (listing.priceAmount === undefined) {
            throw new Error(`onthemarket: listing ${listing.sourceId} has no resolvable price`);
        }
        const isSale = listing.kind === 'sale';
        const result = {
            source: this.id,
            sourceId: listing.sourceId,
            sourceUrl: listing.url,
            address: buildAddress(listing),
            type: (0, housing_1.resolveGbPropertyType)(listing.propertyType),
            offerings: isSale ? [shared_types_1.OfferingType.SALE] : [shared_types_1.OfferingType.LONG_TERM_RENT],
            longTermRent: isSale
                ? undefined
                : { monthlyAmount: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' },
            sale: isSale ? { price: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' } : undefined,
            remoteImages: toRemoteImages(listing.images),
            status: 'published',
        };
        if (listing.description ?? listing.summary) {
            result.description = listing.description ?? listing.summary;
        }
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
                detail: `attempts=${snapshot.attempts} challengeRate=${snapshot.challengeRate.toFixed(2)}`,
            };
        }
        return {
            provider: this.id,
            status: 'healthy',
            detail: `Serving GB via ${fixtures_1.ONTHEMARKET_BASE_URL} (__NEXT_DATA__ property JSON; housing-only)`,
        };
    }
}
exports.OnTheMarketProvider = OnTheMarketProvider;
