"use strict";
/**
 * Casa.it provider (Italy) — search AJAX first, JSON-LD detail + contact JSON.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.casaItSourceIdFromUrl = exports.CasaItProvider = void 0;
exports.isCasaItChallenge = isCasaItChallenge;
const shared_types_1 = require("@homiio/shared-types");
const session_1 = require("../../../session");
const proxy_1 = require("../../../proxy");
const runtime_1 = require("../../../runtime");
const strategy_1 = require("../../../strategy");
const metrics_1 = require("../../../metrics");
const fixtures_1 = require("./fixtures");
const parse_1 = require("./parse");
Object.defineProperty(exports, "casaItSourceIdFromUrl", { enumerable: true, get: function () { return parse_1.casaItSourceIdFromUrl; } });
const PROVIDER_ID = 'casa_it';
const DEFAULT_CITIES = ['roma', 'milano', 'napoli', 'torino', 'firenze'];
const MAX_SEARCH_PAGES = 3;
function isCasaItChallenge(html) {
    if (html.trim().length < 512)
        return true;
    return /datadome|captcha-delivery|accesso negato|verifica/i.test(html);
}
function resolvePropertyType(types) {
    const lower = types.map((type) => type.toLowerCase());
    if (lower.some((type) => type.includes('house') || type.includes('villa')))
        return shared_types_1.PropertyType.HOUSE;
    if (lower.some((type) => type.includes('studio') || type.includes('monolocale')))
        return shared_types_1.PropertyType.STUDIO;
    return shared_types_1.PropertyType.APARTMENT;
}
function toRemoteImages(listing) {
    return listing.images.map((url, index) => ({ url, isPrimary: index === 0 }));
}
function asCasaItRaw(payload) {
    const record = payload;
    if (!record ||
        typeof record.sourceId !== 'string' ||
        typeof record.url !== 'string' ||
        typeof record.listing !== 'object') {
        throw new Error('casa_it: normalize received a payload that is not a CasaItRaw');
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
class CasaItProvider {
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
                warmUrl: (0, parse_1.casaItWarmSearchUrl)(city, 1),
                signal,
                contentSelector: 'a[href*="/immobili/"], main, article',
                isChallenge: isCasaItChallenge,
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
                const ajaxUrl = (0, parse_1.casaItSearchApiUrl)(city, page);
                const { status, body } = await session.request(ajaxUrl, {
                    referer: session.pageUrl(),
                    timeoutMs: 30000,
                });
                let pageRefs = status < 400 && !isCasaItChallenge(body) ? (0, parse_1.parseCasaItSearchJson)(body) : [];
                if (pageRefs.length === 0 && page === 1) {
                    pageRefs = (0, parse_1.parseCasaItSearch)(await session.content());
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
                url: (0, parse_1.casaItWarmSearchUrl)(city, 1),
                detail: `casa.it warm-up failed: ${detail}`,
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
                const { html } = await (0, strategy_1.fetchListingViaLadder)(runtime, (0, parse_1.casaItWarmSearchUrl)(city, page), {
                    provider: this.id,
                    isChallenge: isCasaItChallenge,
                    metrics: this.metrics,
                    init: { signal },
                });
                const refs = (0, parse_1.parseCasaItSearch)(html);
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
            const sticky = (0, proxy_1.envBool)('LISTING_PROXY_STICKY', false);
            if (sticky && !this.stickyProxySessionId)
                this.stickyProxySessionId = (0, proxy_1.createProxySessionId)();
            let session;
            try {
                session = await ctx.runtime.openBrowserSession({
                    warmUrl: ref.url,
                    signal: ctx.signal,
                    contentSelector: 'script[type="application/ld+json"], main, h1',
                    isChallenge: isCasaItChallenge,
                    challengeWaitMs: 45000,
                    stickyProxySession: sticky,
                    proxySessionId: this.stickyProxySessionId,
                    storageState: this.stickyStorageState,
                    blockAssets: true,
                    locale: 'it-IT',
                });
                const html = await session.content();
                if (!isCasaItChallenge(html)) {
                    if (sticky)
                        this.stickyStorageState = await session.exportStorageState();
                    return { ref, payload: (0, parse_1.parseCasaItDetail)(html, ref.url) };
                }
            }
            catch {
                // Fall through to ladder.
            }
            finally {
                await session?.close();
            }
        }
        const { html } = await (0, strategy_1.fetchListingViaLadder)(ctx.runtime, ref.url, {
            provider: this.id,
            isChallenge: isCasaItChallenge,
            init: { signal: ctx.signal },
            metrics: this.metrics,
        });
        return { ref, payload: (0, parse_1.parseCasaItDetail)(html, ref.url) };
    }
    normalize(raw) {
        const { sourceId, url, listing, contact } = asCasaItRaw(raw.payload);
        if (listing.price === undefined) {
            throw new Error(`casa_it: listing ${sourceId} has no resolvable price`);
        }
        const isSale = listing.operation === 'sale';
        const currency = listing.priceCurrency ?? 'EUR';
        const result = {
            source: this.id,
            sourceId,
            sourceUrl: url,
            address: {
                street: listing.address.street ?? listing.address.city ?? '',
                city: listing.address.city ?? '',
                state: listing.address.region,
                country: listing.address.country ?? 'Italy',
                countryCode: listing.address.countryCode ?? 'IT',
                postalCode: listing.address.postalCode,
                neighborhood: listing.address.neighborhood,
                coordinates: listing.coordinates,
            },
            type: resolvePropertyType(listing.types),
            offerings: isSale ? [shared_types_1.OfferingType.SALE] : [shared_types_1.OfferingType.LONG_TERM_RENT],
            longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency },
            sale: isSale ? { price: listing.price, currency } : undefined,
            remoteImages: toRemoteImages(listing),
            status: 'published',
        };
        const description = listing.description ?? listing.name;
        if (description)
            result.description = description;
        if (listing.bedrooms !== undefined)
            result.bedrooms = listing.bedrooms;
        if (listing.bathrooms !== undefined)
            result.bathrooms = listing.bathrooms;
        if (listing.squareMeters !== undefined)
            result.squareFootage = listing.squareMeters;
        if (listing.amenities.length > 0)
            result.amenities = listing.amenities;
        if (listing.furnished === true)
            result.furnishedStatus = 'furnished';
        if (contact)
            result.contact = contact;
        return result;
    }
    async health() {
        return {
            provider: this.id,
            status: 'healthy',
            detail: `Serving IT via ${fixtures_1.CASA_IT_BASE_URL} (search AJAX + JSON-LD)`,
        };
    }
}
exports.CasaItProvider = CasaItProvider;
