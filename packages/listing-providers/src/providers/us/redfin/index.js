"use strict";
/**
 * Redfin provider (United States).
 *
 * Redfin's Stingray JSON endpoints are CloudFront-gated on cold HTTP. This
 * plugin warms a Playwright session on a city search page, then calls
 * `/stingray/api/gis` and `/stingray/api/home/details/initialInfo` via
 * `session.request` (shared browser-session pattern). Registered OFF by default
 * (`PROVIDER_REDFIN_ENABLED`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.redfinKindFromHome = exports.parseRedfinDetailResponse = exports.parseRedfinGisResponse = exports.RedfinProvider = void 0;
const shared_types_1 = require("@homiio/shared-types");
const session_1 = require("../../../session");
const runtime_1 = require("../../../runtime");
const strategy_1 = require("../../../strategy");
const metrics_1 = require("../../../metrics");
const proxy_1 = require("../../../proxy");
const portals_1 = require("../portals");
const challenge_1 = require("../challenge");
const api_1 = require("./api");
Object.defineProperty(exports, "parseRedfinDetailResponse", { enumerable: true, get: function () { return api_1.parseRedfinDetailResponse; } });
Object.defineProperty(exports, "parseRedfinGisResponse", { enumerable: true, get: function () { return api_1.parseRedfinGisResponse; } });
Object.defineProperty(exports, "redfinKindFromHome", { enumerable: true, get: function () { return api_1.redfinKindFromHome; } });
const fixtures_1 = require("./fixtures");
const PROVIDER_ID = 'redfin';
const CURRENCY = 'USD';
const COUNTRY = 'United States';
const GIS_PAGE_SIZE = 50;
const MAX_GIS_PAGES = 2;
function regionIdFromWarmUrl(warmUrl) {
    const match = warmUrl.match(/\/city\/(\d+)\//);
    if (!match?.[1])
        return undefined;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function refKind(ref) {
    return ref.hints?.kind === 'sale' ? 'sale' : 'rent';
}
function resolvePropertyType(kind) {
    return kind === 'sale' ? shared_types_1.PropertyType.HOUSE : shared_types_1.PropertyType.APARTMENT;
}
function toRemoteImages(home) {
    return home.photoUrls.map((url, index) => ({ url, isPrimary: index === 0 }));
}
function buildAddress(home) {
    return {
        street: home.street,
        city: home.city,
        state: home.state,
        country: COUNTRY,
        countryCode: 'US',
        postalCode: home.zip,
        coordinates: { lat: home.lat, lng: home.lng },
    };
}
function asRedfinRaw(payload) {
    const record = payload;
    if (!record ||
        typeof record.sourceId !== 'string' ||
        typeof record.url !== 'string' ||
        (record.kind !== 'rent' && record.kind !== 'sale') ||
        typeof record.home !== 'object' ||
        record.home === null) {
        throw new Error('redfin provider received a payload that is not a RedfinRaw');
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
        out.push({
            provider: PROVIDER_ID,
            sourceId: ref.sourceId,
            url: ref.url,
            hints: { kind: ref.kind, homePath: ref.homePath },
        });
        yielded.count += 1;
    }
    return out;
}
class RedfinProvider {
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
        const yielded = { count: 0 };
        for (const city of cities) {
            if (yielded.count >= limit)
                return;
            const viaAjax = runtime.openBrowserSession
                ? await this.discoverCityViaStingray(runtime, city, job.signal, seen, limit, yielded)
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
    async discoverCityViaStingray(runtime, city, signal, seen, limit, yielded) {
        if (!runtime.openBrowserSession)
            return [];
        const citySlug = (0, portals_1.cityToResourceSlug)(city);
        const warmUrl = (0, api_1.redfinWarmUrl)(citySlug);
        const regionId = regionIdFromWarmUrl(warmUrl);
        if (regionId === undefined)
            return [];
        const sticky = (0, proxy_1.envBool)('LISTING_PROXY_STICKY', false);
        if (sticky && !this.stickyProxySessionId) {
            this.stickyProxySessionId = (0, proxy_1.createProxySessionId)();
        }
        let session;
        const start = Date.now();
        try {
            session = await runtime.openBrowserSession({
                warmUrl,
                signal,
                contentSelector: api_1.REDFIN_CONTENT_SELECTOR,
                isChallenge: challenge_1.isUsPortalChallenge,
                challengeWaitMs: 45000,
                stickyProxySession: sticky,
                proxySessionId: this.stickyProxySessionId,
                storageState: this.stickyStorageState,
                blockAssets: true,
            });
            const collected = [];
            for (let page = 1; page <= MAX_GIS_PAGES; page += 1) {
                if (yielded.count >= limit)
                    break;
                const ajaxUrl = (0, api_1.redfinGisUrl)(regionId, page, GIS_PAGE_SIZE);
                const { status, body } = await session.request(ajaxUrl, {
                    referer: session.pageUrl(),
                    timeoutMs: 30000,
                });
                if (status === 403 || status === 429 || (0, api_1.isRedfinStingrayChallenge)(body)) {
                    this.metrics.record({
                        provider: this.id,
                        strategy: 'browser',
                        outcome: 'challenge',
                        status,
                        latencyMs: Date.now() - start,
                        url: ajaxUrl,
                        detail: 'Stingray GIS challenge after warm-up',
                    });
                    break;
                }
                if (status >= 400)
                    break;
                const pageRefs = (0, api_1.parseRedfinGisResponse)(body);
                this.metrics.record({
                    provider: this.id,
                    strategy: 'browser',
                    outcome: pageRefs.length > 0 ? 'success' : 'error',
                    status,
                    latencyMs: Date.now() - start,
                    url: ajaxUrl,
                });
                if (pageRefs.length === 0)
                    break;
                collected.push(...yieldRefs(pageRefs, seen, limit, yielded));
            }
            if (sticky) {
                this.stickyStorageState = await session.exportStorageState();
            }
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
                url: warmUrl,
                detail: `Stingray warm-up failed: ${detail}`,
            });
            return [];
        }
        finally {
            await session?.close();
        }
    }
    async *discoverCityViaHtml(runtime, city, signal, seen, limit, yielded) {
        const warmUrl = (0, api_1.redfinWarmUrl)((0, portals_1.cityToResourceSlug)(city));
        const { html } = await (0, strategy_1.fetchListingViaLadder)(runtime, warmUrl, {
            provider: this.id,
            isChallenge: challenge_1.isUsPortalChallenge,
            metrics: this.metrics,
            init: { signal },
            tiers: ['browser', 'managed'],
        });
        const homePathRe = /href="(\/[^"]+\/home\/\d+)"/gi;
        const refs = [];
        for (const match of html.matchAll(homePathRe)) {
            const homePath = match[1];
            if (!homePath)
                continue;
            const propertyMatch = homePath.match(/\/home\/(\d+)/);
            const propertyId = propertyMatch?.[1];
            if (!propertyId)
                continue;
            refs.push({
                sourceId: propertyId,
                url: (0, api_1.redfinSourceUrl)(homePath),
                kind: 'sale',
                homePath,
            });
        }
        for (const ref of yieldRefs(refs, seen, limit, yielded)) {
            yield ref;
        }
    }
    async fetch(ref, ctx) {
        const homePath = typeof ref.hints?.homePath === 'string' ? ref.hints.homePath : undefined;
        if (homePath && ctx.runtime.openBrowserSession) {
            const fromSession = await this.fetchViaStingray(ref, ctx, homePath);
            if (fromSession)
                return fromSession;
        }
        const { html } = await (0, strategy_1.fetchListingViaLadder)(ctx.runtime, ref.url, {
            provider: this.id,
            isChallenge: challenge_1.isUsPortalChallenge,
            init: { signal: ctx.signal },
            metrics: this.metrics,
            tiers: ['browser', 'managed'],
        });
        const detail = (0, api_1.parseRedfinDetailResponse)(html);
        if (!detail) {
            throw new Error(`redfin: no listing payload found at ${ref.url}`);
        }
        return {
            ref,
            payload: {
                sourceId: ref.sourceId,
                url: ref.url,
                kind: refKind(ref),
                home: detail,
            },
        };
    }
    async fetchViaStingray(ref, ctx, homePath) {
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
                contentSelector: api_1.REDFIN_CONTENT_SELECTOR,
                isChallenge: challenge_1.isUsPortalChallenge,
                challengeWaitMs: 45000,
                stickyProxySession: sticky,
                proxySessionId: this.stickyProxySessionId,
                storageState: this.stickyStorageState,
                blockAssets: true,
            });
            const ajaxUrl = (0, api_1.redfinInitialInfoUrl)(homePath);
            const { status, body } = await session.request(ajaxUrl, {
                referer: session.pageUrl(),
                timeoutMs: 30000,
            });
            if (status >= 400 || (0, api_1.isRedfinStingrayChallenge)(body))
                return undefined;
            const home = (0, api_1.parseRedfinDetailResponse)(body);
            if (!home)
                return undefined;
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'success',
                status,
                latencyMs: Date.now() - start,
                url: ajaxUrl,
            });
            if (sticky) {
                this.stickyStorageState = await session.exportStorageState();
            }
            const kind = refKind(ref);
            return {
                ref,
                payload: { sourceId: ref.sourceId, url: ref.url, kind, home },
            };
        }
        catch {
            return undefined;
        }
        finally {
            await session?.close();
        }
    }
    normalize(raw) {
        const { sourceId, url, kind, home } = asRedfinRaw(raw.payload);
        const result = {
            source: this.id,
            sourceId,
            sourceUrl: url,
            address: buildAddress(home),
            type: resolvePropertyType(kind),
            offerings: kind === 'sale' ? [shared_types_1.OfferingType.SALE] : [shared_types_1.OfferingType.LONG_TERM_RENT],
            remoteImages: toRemoteImages(home),
            status: 'published',
            bedrooms: home.beds,
            bathrooms: home.baths,
            squareFootage: home.sqFt,
        };
        if (kind === 'sale') {
            result.sale = { price: home.price, currency: CURRENCY };
        }
        else {
            result.longTermRent = { monthlyAmount: home.price, currency: CURRENCY };
        }
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
            detail: `Serving ${this.markets.join(', ')} via ${fixtures_1.REDFIN_BASE_URL} Stingray (browser session)`,
        };
    }
}
exports.RedfinProvider = RedfinProvider;
