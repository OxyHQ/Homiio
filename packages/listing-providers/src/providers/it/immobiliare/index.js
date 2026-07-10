"use strict";
/**
 * Immobiliare.it provider (Italy) — JSON/AJAX first via search-list API + `__NEXT_DATA__`.
 *
 * Discover: warm session → search-list AJAX → `__NEXT_DATA__` / HTML link fallback.
 * Fetch: detail `__NEXT_DATA__` (includes advertiser contact when present).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.immobiliareSourceIdFromUrl = exports.ImmobiliareProvider = void 0;
exports.isImmobiliareChallenge = isImmobiliareChallenge;
const shared_types_1 = require("@homiio/shared-types");
const session_1 = require("../../../session");
const proxy_1 = require("../../../proxy");
const runtime_1 = require("../../../runtime");
const strategy_1 = require("../../../strategy");
const metrics_1 = require("../../../metrics");
const fixtures_1 = require("./fixtures");
const parse_1 = require("./parse");
Object.defineProperty(exports, "immobiliareSourceIdFromUrl", { enumerable: true, get: function () { return parse_1.immobiliareSourceIdFromUrl; } });
const PROVIDER_ID = 'immobiliare';
const DEFAULT_CITIES = ['roma', 'milano', 'napoli', 'torino', 'firenze'];
const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR = 'a[href*="/annunci/"], main, #__NEXT_DATA__, [data-testid="listing-card"]';
function isImmobiliareChallenge(html) {
    if (html.trim().length < 512)
        return true;
    return /datadome|captcha-delivery|accesso negato|verifica che sei/i.test(html);
}
function resolvePropertyType(raw) {
    const lower = (raw ?? '').toLowerCase();
    if (/villa|casa indipendente|house|single/.test(lower))
        return shared_types_1.PropertyType.HOUSE;
    if (/monolocale|studio/.test(lower))
        return shared_types_1.PropertyType.STUDIO;
    return shared_types_1.PropertyType.APARTMENT;
}
function asImmobiliareRaw(payload) {
    const record = payload;
    if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
        throw new Error('immobiliare: normalize received a payload that is not an ImmobiliareRaw');
    }
    return payload;
}
function yieldRefs(refs, seen, limit, yielded) {
    const out = [];
    for (const ref of refs) {
        if (yielded.count >= limit)
            break;
        if (seen.has(ref.sourceId))
            continue;
        seen.add(ref.sourceId);
        out.push({ provider: PROVIDER_ID, sourceId: ref.sourceId, url: ref.url });
        yielded.count += 1;
    }
    return out;
}
class ImmobiliareProvider {
    constructor(options = {}) {
        this.id = PROVIDER_ID;
        this.markets = ['IT'];
        this.runtime = options.runtime ?? (0, runtime_1.createFetchRuntime)();
        this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
        this.metrics = options.metrics ?? metrics_1.defaultProviderMetrics;
    }
    async *discover(job) {
        const cities = job.city ? [job.city] : this.cities;
        const limit = job.limit ?? Number.POSITIVE_INFINITY;
        const seen = new Set();
        const yielded = { count: 0 };
        const runtime = job.runtime ?? this.runtime;
        for (const city of cities) {
            if (yielded.count >= limit)
                return;
            const viaAjax = runtime.openBrowserSession
                ? await this.discoverCityViaAjax(runtime, city, job.signal, seen, limit, yielded)
                : [];
            for (const ref of viaAjax)
                yield ref;
            if (yielded.count >= limit)
                return;
            if (viaAjax.length === 0) {
                for await (const ref of this.discoverCityViaHtml(runtime, city, job.signal, seen, limit, yielded)) {
                    yield ref;
                }
            }
        }
    }
    async discoverCityViaAjax(runtime, city, signal, seen, limit, yielded) {
        if (!runtime.openBrowserSession)
            return [];
        const sticky = (0, proxy_1.envBool)('LISTING_PROXY_STICKY', false);
        if (sticky && !this.stickyProxySessionId)
            this.stickyProxySessionId = (0, proxy_1.createProxySessionId)();
        let session;
        const start = Date.now();
        try {
            session = await runtime.openBrowserSession({
                warmUrl: (0, parse_1.immobiliareWarmSearchUrl)(city, 1),
                signal,
                contentSelector: CONTENT_SELECTOR,
                isChallenge: isImmobiliareChallenge,
                challengeWaitMs: 45000,
                stickyProxySession: sticky,
                proxySessionId: this.stickyProxySessionId,
                storageState: this.stickyStorageState,
                blockAssets: true,
                locale: 'it-IT',
            });
            const collected = [];
            for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
                if (yielded.count >= limit)
                    break;
                let pageRefs = [];
                for (const ajaxUrl of (0, parse_1.immobiliareSearchApiUrls)(city, page)) {
                    const { status, body } = await session.request(ajaxUrl, {
                        referer: session.pageUrl(),
                        timeoutMs: 30000,
                    });
                    if (status >= 400 || isImmobiliareChallenge(body))
                        continue;
                    pageRefs = (0, parse_1.parseImmobiliareSearchJson)(body);
                    if (pageRefs.length > 0) {
                        this.metrics.record({
                            provider: this.id,
                            strategy: 'browser',
                            outcome: 'success',
                            status,
                            latencyMs: Date.now() - start,
                            url: ajaxUrl,
                        });
                        break;
                    }
                }
                if (pageRefs.length === 0 && page === 1) {
                    const html = await session.content();
                    pageRefs = (0, parse_1.parseImmobiliareSearch)(html);
                }
                if (pageRefs.length === 0)
                    break;
                collected.push(...yieldRefs(pageRefs, seen, limit, yielded));
            }
            if (sticky)
                this.stickyStorageState = await session.exportStorageState();
            return collected;
        }
        catch (error) {
            const detail = error instanceof session_1.BrowserSessionChallengeError
                ? error.detail
                : error instanceof Error
                    ? error.message
                    : String(error);
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'challenge',
                latencyMs: Date.now() - start,
                url: (0, parse_1.immobiliareWarmSearchUrl)(city, 1),
                detail: `immobiliare warm-up failed: ${detail}`,
            });
            return [];
        }
        finally {
            await session?.close();
        }
    }
    async *discoverCityViaHtml(runtime, city, signal, seen, limit, yielded) {
        for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
            if (yielded.count >= limit)
                return;
            try {
                const { html } = await (0, strategy_1.fetchListingViaLadder)(runtime, (0, parse_1.immobiliareWarmSearchUrl)(city, page), {
                    provider: this.id,
                    isChallenge: isImmobiliareChallenge,
                    metrics: this.metrics,
                    init: { signal },
                });
                const refs = (0, parse_1.parseImmobiliareSearch)(html);
                if (refs.length === 0)
                    return;
                for (const ref of yieldRefs(refs, seen, limit, yielded))
                    yield ref;
            }
            catch (error) {
                if (error instanceof strategy_1.ChallengeError)
                    return;
                throw error;
            }
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
            isChallenge: isImmobiliareChallenge,
            init: { signal: ctx.signal },
            metrics: this.metrics,
        });
        return { ref, payload: (0, parse_1.parseImmobiliareDetail)(html, ref.url) };
    }
    async fetchDetailViaSession(ref, ctx) {
        if (!ctx.runtime.openBrowserSession)
            return undefined;
        const sticky = (0, proxy_1.envBool)('LISTING_PROXY_STICKY', false);
        if (sticky && !this.stickyProxySessionId)
            this.stickyProxySessionId = (0, proxy_1.createProxySessionId)();
        let session;
        const start = Date.now();
        try {
            session = await ctx.runtime.openBrowserSession({
                warmUrl: ref.url,
                signal: ctx.signal,
                contentSelector: '#__NEXT_DATA__, main, h1',
                isChallenge: isImmobiliareChallenge,
                challengeWaitMs: 45000,
                stickyProxySession: sticky,
                proxySessionId: this.stickyProxySessionId,
                storageState: this.stickyStorageState,
                blockAssets: true,
                locale: 'it-IT',
            });
            const html = await session.content();
            if (isImmobiliareChallenge(html))
                return undefined;
            const payload = (0, parse_1.parseImmobiliareDetail)(html, ref.url);
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'success',
                latencyMs: Date.now() - start,
                url: ref.url,
            });
            if (sticky)
                this.stickyStorageState = await session.exportStorageState();
            return { ref, payload };
        }
        catch {
            return undefined;
        }
        finally {
            await session?.close();
        }
    }
    normalize(raw) {
        const listing = asImmobiliareRaw(raw.payload);
        if (listing.price === undefined) {
            throw new Error(`immobiliare: listing ${listing.sourceId} has no resolvable price`);
        }
        const isSale = listing.operation === 'sale';
        const images = listing.images.map((url, index) => ({
            url,
            isPrimary: index === 0,
        }));
        const result = {
            source: this.id,
            sourceId: listing.sourceId,
            sourceUrl: listing.url,
            address: {
                street: listing.street ?? listing.city ?? '',
                city: listing.city ?? '',
                state: listing.region,
                country: 'Italy',
                countryCode: 'IT',
                postalCode: listing.postalCode,
                neighborhood: listing.neighborhood,
                coordinates: listing.coordinates,
            },
            type: resolvePropertyType(listing.propertyType),
            offerings: isSale ? [shared_types_1.OfferingType.SALE] : [shared_types_1.OfferingType.LONG_TERM_RENT],
            longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
            sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
            remoteImages: images,
            status: 'published',
        };
        if (listing.description ?? listing.title)
            result.description = listing.description ?? listing.title;
        if (listing.bedrooms !== undefined)
            result.bedrooms = listing.bedrooms;
        if (listing.bathrooms !== undefined)
            result.bathrooms = listing.bathrooms;
        if (listing.squareMeters !== undefined)
            result.squareFootage = listing.squareMeters;
        if (listing.floor !== undefined)
            result.floor = listing.floor;
        if (listing.amenities.length > 0)
            result.amenities = listing.amenities;
        if (listing.furnished === true)
            result.furnishedStatus = 'furnished';
        if (listing.contact)
            result.contact = listing.contact;
        return result;
    }
    async health() {
        return {
            provider: this.id,
            status: 'healthy',
            detail: `Serving IT via ${fixtures_1.IMMOBILIARE_BASE_URL} (search-list AJAX + __NEXT_DATA__)`,
        };
    }
}
exports.ImmobiliareProvider = ImmobiliareProvider;
