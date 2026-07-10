"use strict";
/**
 * Idealista.it provider (Italy) — AJAX-with-Playwright-session pattern.
 *
 * Separate from ES `idealista` (different host, `/immobile/`, Italian paths).
 *
 * Discover: warm session → georeach AJAX → HTML search fallback.
 * Fetch: detail HTML JSON-LD + optional contact AJAX (phones / agency).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.idealistaItSourceIdFromUrl = exports.IdealistaItProvider = void 0;
exports.isIdealistaItChallenge = isIdealistaItChallenge;
const shared_types_1 = require("@homiio/shared-types");
const session_1 = require("../../../session");
const proxy_1 = require("../../../proxy");
const runtime_1 = require("../../../runtime");
const strategy_1 = require("../../../strategy");
const metrics_1 = require("../../../metrics");
const fixtures_1 = require("./fixtures");
const contact_1 = require("./contact");
const georeach_1 = require("./georeach");
const parse_1 = require("./parse");
Object.defineProperty(exports, "idealistaItSourceIdFromUrl", { enumerable: true, get: function () { return parse_1.idealistaItSourceIdFromUrl; } });
const PROVIDER_ID = 'idealista_it';
const DEFAULT_CITIES = ['roma', 'milano', 'napoli', 'torino', 'firenze'];
const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR = 'article.item, .items-list, section.items-container, main#main-content, #main-content';
function isIdealistaItChallenge(html) {
    if (html.trim().length < 512)
        return true;
    return /accesso negato|verifica che sei un umano|datadome|captcha-delivery/i.test(html);
}
function resolvePropertyType(types) {
    const lower = types.map((type) => type.toLowerCase());
    if (lower.some((type) => type.includes('house') || type.includes('villa') || type.includes('singlefamily'))) {
        return shared_types_1.PropertyType.HOUSE;
    }
    if (lower.some((type) => type.includes('studio') || type.includes('monolocale')))
        return shared_types_1.PropertyType.STUDIO;
    return shared_types_1.PropertyType.APARTMENT;
}
function resolveFurnished(furnished) {
    if (furnished === true)
        return 'furnished';
    if (furnished === false)
        return 'unfurnished';
    return 'not_specified';
}
function toRemoteImages(listing) {
    return listing.images.map((url, index) => ({ url, isPrimary: index === 0 }));
}
function asIdealistaItRaw(payload) {
    const record = payload;
    if (!record ||
        typeof record.sourceId !== 'string' ||
        typeof record.url !== 'string' ||
        typeof record.listing !== 'object') {
        throw new Error('idealista_it: normalize received a payload that is not an IdealistaItRaw');
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
async function fetchContactViaSession(session, sourceId) {
    const phonesBody = await session.request((0, contact_1.idealistaItContactPhonesUrl)(sourceId), {
        referer: session.pageUrl(),
        timeoutMs: 15000,
    });
    const phones = phonesBody.status < 400 ? (0, contact_1.parseIdealistaItContactPhones)(phonesBody.body) : [];
    const infoBody = await session.request((0, contact_1.idealistaItContactInfoUrl)(sourceId), {
        referer: session.pageUrl(),
        timeoutMs: 15000,
    });
    const info = infoBody.status < 400 ? (0, contact_1.parseIdealistaItContactInfo)(infoBody.body) : undefined;
    return (0, contact_1.mergeIdealistaItContact)(info, phones[0] ? { phone: phones[0] } : undefined);
}
class IdealistaItProvider {
    constructor(options = {}) {
        this.id = PROVIDER_ID;
        this.markets = ['IT'];
        this.hasOfficialApi = true;
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
                ? await this.discoverCityViaGeoreach(runtime, city, job.signal, seen, limit, yielded)
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
    async discoverCityViaGeoreach(runtime, city, signal, seen, limit, yielded) {
        if (!runtime.openBrowserSession)
            return [];
        const sticky = (0, proxy_1.envBool)('LISTING_PROXY_STICKY', false);
        if (sticky && !this.stickyProxySessionId)
            this.stickyProxySessionId = (0, proxy_1.createProxySessionId)();
        let session;
        const start = Date.now();
        try {
            session = await runtime.openBrowserSession({
                warmUrl: (0, georeach_1.idealistaItWarmSearchUrl)(city, 1),
                signal,
                contentSelector: CONTENT_SELECTOR,
                isChallenge: isIdealistaItChallenge,
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
                const ajaxUrl = (0, georeach_1.idealistaItGeoreachUrl)(city, page);
                const { status, body } = await session.request(ajaxUrl, {
                    referer: session.pageUrl(),
                    timeoutMs: 30000,
                });
                if (status === 403 || status === 429 || (0, georeach_1.isIdealistaItGeoreachChallenge)(body)) {
                    this.metrics.record({
                        provider: this.id,
                        strategy: 'browser',
                        outcome: 'challenge',
                        status,
                        latencyMs: Date.now() - start,
                        url: ajaxUrl,
                        detail: 'georeach DataDome challenge after warm-up',
                    });
                    break;
                }
                if (status >= 400)
                    break;
                const pageRefs = (0, georeach_1.parseIdealistaItGeoreach)(body);
                this.metrics.record({
                    provider: this.id,
                    strategy: 'browser',
                    outcome: 'success',
                    status,
                    latencyMs: Date.now() - start,
                    url: ajaxUrl,
                });
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
                url: (0, georeach_1.idealistaItWarmSearchUrl)(city, 1),
                detail: `georeach warm-up failed: ${detail}`,
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
                const { html } = await (0, strategy_1.fetchListingViaLadder)(runtime, (0, georeach_1.idealistaItWarmSearchUrl)(city, page), {
                    provider: this.id,
                    isChallenge: isIdealistaItChallenge,
                    metrics: this.metrics,
                    init: { signal },
                });
                const refs = (0, parse_1.parseIdealistaItSearch)(html);
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
            isChallenge: isIdealistaItChallenge,
            init: { signal: ctx.signal },
            metrics: this.metrics,
        });
        return { ref, payload: (0, parse_1.parseIdealistaItDetail)(html, ref.url) };
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
                contentSelector: 'script[type="application/ld+json"], main, h1',
                isChallenge: isIdealistaItChallenge,
                challengeWaitMs: 45000,
                stickyProxySession: sticky,
                proxySessionId: this.stickyProxySessionId,
                storageState: this.stickyStorageState,
                blockAssets: true,
                locale: 'it-IT',
            });
            const html = await session.content();
            if (isIdealistaItChallenge(html)) {
                this.metrics.record({
                    provider: this.id,
                    strategy: 'browser',
                    outcome: 'challenge',
                    latencyMs: Date.now() - start,
                    url: ref.url,
                    detail: 'detail session still challenged',
                });
                return undefined;
            }
            const payload = (0, parse_1.parseIdealistaItDetail)(html, ref.url);
            const contact = await fetchContactViaSession(session, payload.sourceId);
            if (contact)
                payload.contact = contact;
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
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'error',
                latencyMs: Date.now() - start,
                url: ref.url,
                detail: 'detail session warm-up failed; falling back to ladder',
            });
            return undefined;
        }
        finally {
            await session?.close();
        }
    }
    normalize(raw) {
        const { sourceId, url, listing, contact } = asIdealistaItRaw(raw.payload);
        if (listing.price === undefined) {
            throw new Error(`idealista_it: listing ${sourceId} has no resolvable price`);
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
        if (description !== undefined)
            result.description = description;
        if (listing.bedrooms !== undefined)
            result.bedrooms = listing.bedrooms;
        if (listing.bathrooms !== undefined)
            result.bathrooms = listing.bathrooms;
        if (listing.squareMeters !== undefined)
            result.squareFootage = listing.squareMeters;
        if (listing.amenities.length > 0)
            result.amenities = listing.amenities;
        const furnished = resolveFurnished(listing.furnished);
        if (furnished !== 'not_specified')
            result.furnishedStatus = furnished;
        if (contact)
            result.contact = contact;
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
            detail: `Serving IT via ${fixtures_1.IDEALISTA_IT_BASE_URL} (georeach AJAX + contact AJAX + HTML fallback)`,
        };
    }
}
exports.IdealistaItProvider = IdealistaItProvider;
