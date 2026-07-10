"use strict";
/**
 * Subito.it provider (Italy) — housing-only classifieds.
 *
 * CRITICAL: never site-wide crawl. Discover uses `/affitto/appartamenti/` only;
 * `normalize()` rejects non-housing categories.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSubitoHousingCategory = exports.subitoSourceIdFromUrl = exports.SubitoProvider = void 0;
exports.isSubitoChallenge = isSubitoChallenge;
const shared_types_1 = require("@homiio/shared-types");
const session_1 = require("../../../session");
const proxy_1 = require("../../../proxy");
const runtime_1 = require("../../../runtime");
const strategy_1 = require("../../../strategy");
const metrics_1 = require("../../../metrics");
const fixtures_1 = require("./fixtures");
const parse_1 = require("./parse");
Object.defineProperty(exports, "isSubitoHousingCategory", { enumerable: true, get: function () { return parse_1.isSubitoHousingCategory; } });
Object.defineProperty(exports, "subitoSourceIdFromUrl", { enumerable: true, get: function () { return parse_1.subitoSourceIdFromUrl; } });
const PROVIDER_ID = 'subito';
const DEFAULT_CITIES = ['roma', 'milano', 'napoli', 'torino', 'firenze'];
const MAX_SEARCH_PAGES = 3;
function isSubitoChallenge(html) {
    if (html.trim().length < 256)
        return true;
    return /access denied|datadome|captcha|akamai|bot detection/i.test(html);
}
function asSubitoRaw(payload) {
    const record = payload;
    if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
        throw new Error('subito: normalize received a payload that is not a SubitoRaw');
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
        if (!(0, parse_1.isSubitoHousingCategory)(ref.url))
            continue;
        seen.add(ref.sourceId);
        out.push({ provider: PROVIDER_ID, sourceId: ref.sourceId, url: ref.url });
        yielded.count += 1;
    }
    return out;
}
class SubitoProvider {
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
                warmUrl: (0, parse_1.subitoWarmSearchUrl)(city, 1),
                signal,
                contentSelector: 'a[href*="/appartamenti/"], main, #__NEXT_DATA__',
                isChallenge: isSubitoChallenge,
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
                const ajaxUrl = (0, parse_1.subitoSearchApiUrl)(city, page);
                const { status, body } = await session.request(ajaxUrl, {
                    referer: session.pageUrl(),
                    timeoutMs: 30000,
                });
                let pageRefs = status < 400 && !isSubitoChallenge(body) ? (0, parse_1.parseSubitoSearchJson)(body) : [];
                if (pageRefs.length === 0 && page === 1) {
                    pageRefs = (0, parse_1.parseSubitoSearch)(await session.content());
                }
                if (pageRefs.length === 0)
                    break;
                this.metrics.record({
                    provider: this.id,
                    strategy: 'browser',
                    outcome: 'success',
                    status,
                    latencyMs: Date.now() - start,
                    url: ajaxUrl,
                });
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
                url: (0, parse_1.subitoWarmSearchUrl)(city, 1),
                detail: `subito warm-up failed: ${detail}`,
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
                const { html } = await (0, strategy_1.fetchListingViaLadder)(runtime, (0, parse_1.subitoWarmSearchUrl)(city, page), {
                    provider: this.id,
                    isChallenge: isSubitoChallenge,
                    metrics: this.metrics,
                    init: { signal },
                });
                const refs = (0, parse_1.parseSubitoSearch)(html);
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
        if (!(0, parse_1.isSubitoHousingCategory)(ref.url)) {
            throw new Error(`subito: refusing to fetch non-housing URL ${ref.url}`);
        }
        if (ctx.runtime.openBrowserSession) {
            let session;
            try {
                const sticky = (0, proxy_1.envBool)('LISTING_PROXY_STICKY', false);
                if (sticky && !this.stickyProxySessionId)
                    this.stickyProxySessionId = (0, proxy_1.createProxySessionId)();
                session = await ctx.runtime.openBrowserSession({
                    warmUrl: ref.url,
                    signal: ctx.signal,
                    contentSelector: '#__NEXT_DATA__, main, h1',
                    isChallenge: isSubitoChallenge,
                    challengeWaitMs: 45000,
                    stickyProxySession: sticky,
                    proxySessionId: this.stickyProxySessionId,
                    storageState: this.stickyStorageState,
                    blockAssets: true,
                    locale: 'it-IT',
                });
                const html = await session.content();
                if (!isSubitoChallenge(html)) {
                    if (sticky)
                        this.stickyStorageState = await session.exportStorageState();
                    return { ref, payload: (0, parse_1.parseSubitoDetail)(html, ref.url) };
                }
            }
            catch {
                // Fall through.
            }
            finally {
                await session?.close();
            }
        }
        const { html } = await (0, strategy_1.fetchListingViaLadder)(ctx.runtime, ref.url, {
            provider: this.id,
            isChallenge: isSubitoChallenge,
            init: { signal: ctx.signal },
            metrics: this.metrics,
        });
        return { ref, payload: (0, parse_1.parseSubitoDetail)(html, ref.url) };
    }
    normalize(raw) {
        const listing = asSubitoRaw(raw.payload);
        if (!(0, parse_1.isSubitoHousingCategory)(listing.categoryUri || listing.url)) {
            throw new Error(`subito: non-housing listing rejected (${listing.categoryUri || listing.url})`);
        }
        if (listing.price === undefined) {
            throw new Error(`subito: listing ${listing.sourceId} has no resolvable price`);
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
                street: listing.city ?? '',
                city: listing.city ?? '',
                state: listing.region,
                country: 'Italy',
                countryCode: 'IT',
            },
            type: shared_types_1.PropertyType.APARTMENT,
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
            detail: `Serving IT housing-only via ${fixtures_1.SUBITO_BASE_URL} (appartamenti affitto; non-housing rejected)`,
        };
    }
}
exports.SubitoProvider = SubitoProvider;
