"use strict";
/**
 * milanuncios.com provider (Spain) — general classifieds, REAL-ESTATE ONLY.
 *
 * Classifieds providers must scope discover to real-estate categories and reject
 * non-housing in normalize. Discover uses housing category URLs + AJAX list
 * endpoints from a warmed Playwright session (GeeTest blocks cold HTTP). HTML
 * scrape is last resort and still filtered by category allowlist.
 *
 * Registered OFF by default (`PROVIDER_MILANUNCIOS_ENABLED`). Do NOT enable in
 * prod until the housing filter is verified end-to-end.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMilanunciosAdvert = exports.normalizeMilanunciosRaw = exports.milanunciosSourceIdFromUrl = exports.MilanunciosProvider = void 0;
exports.isMilanunciosChallenge = isMilanunciosChallenge;
const runtime_1 = require("../../runtime");
const metrics_1 = require("../../metrics");
const classifieds_1 = require("../../parse/classifieds");
const fixtures_1 = require("./fixtures");
const parse_1 = require("./parse");
Object.defineProperty(exports, "milanunciosSourceIdFromUrl", { enumerable: true, get: function () { return parse_1.milanunciosSourceIdFromUrl; } });
Object.defineProperty(exports, "normalizeMilanunciosRaw", { enumerable: true, get: function () { return parse_1.normalizeMilanunciosRaw; } });
Object.defineProperty(exports, "parseMilanunciosAdvert", { enumerable: true, get: function () { return parse_1.parseMilanunciosAdvert; } });
const PROVIDER_ID = 'milanuncios';
const DEFAULT_CITIES = ['madrid', 'barcelona', 'valencia'];
const MAX_SEARCH_PAGES = 3;
function isMilanunciosChallenge(body) {
    if (body.trim().length < 256)
        return true;
    return /pardon our interruption|geetest|captcha|datadome|access denied/i.test(body);
}
function asMilanunciosRaw(payload) {
    const record = payload;
    if (!record ||
        typeof record.sourceId !== 'string' ||
        typeof record.url !== 'string' ||
        typeof record.price !== 'number') {
        throw new Error('milanuncios: normalize received a payload that is not a MilanunciosRaw');
    }
    return payload;
}
class MilanunciosProvider {
    constructor(options = {}) {
        this.id = PROVIDER_ID;
        this.markets = ['ES'];
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
                const warmUrl = (0, fixtures_1.milanunciosHousingSearchUrl)(city, page);
                if (!(0, classifieds_1.isHousingCategoryUrl)(warmUrl, fixtures_1.MILANUNCIOS_HOUSING_CATEGORY_SLUGS)) {
                    throw new Error(`milanuncios: refuse non-housing discover URL ${warmUrl}`);
                }
                const refs = runtime.openBrowserSession
                    ? await this.discoverViaSession(runtime, city, page, warmUrl, job.signal)
                    : [];
                if (refs.length === 0)
                    break;
                for (const ref of refs) {
                    if (yielded >= limit)
                        return;
                    if (seen.has(ref.sourceId))
                        continue;
                    seen.add(ref.sourceId);
                    yield { provider: this.id, sourceId: ref.sourceId, url: ref.url };
                    yielded += 1;
                }
            }
        }
    }
    async discoverViaSession(runtime, city, page, warmUrl, signal) {
        if (!runtime.openBrowserSession)
            return [];
        const start = Date.now();
        let session;
        try {
            session = await runtime.openBrowserSession({
                warmUrl,
                signal,
                contentSelector: 'article, .aditem, main, h1',
                isChallenge: isMilanunciosChallenge,
                challengeWaitMs: 45000,
                blockAssets: true,
            });
            const ajaxUrl = (0, fixtures_1.milanunciosListAjaxUrl)(city, page);
            const { status, body } = await session.request(ajaxUrl, {
                referer: session.pageUrl(),
                timeoutMs: 30000,
            });
            if (status === 403 || status === 405 || status === 429 || isMilanunciosChallenge(body)) {
                this.metrics.record({
                    provider: this.id,
                    strategy: 'browser',
                    outcome: 'challenge',
                    status,
                    latencyMs: Date.now() - start,
                    url: ajaxUrl,
                    detail: 'milanuncios list AJAX challenged',
                });
                return [];
            }
            const pageRefs = (0, parse_1.parseMilanunciosSearchJson)(body);
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'success',
                status,
                latencyMs: Date.now() - start,
                url: ajaxUrl,
            });
            return pageRefs.map((ref) => ({ provider: this.id, sourceId: ref.sourceId, url: ref.url }));
        }
        catch {
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'challenge',
                latencyMs: Date.now() - start,
                url: warmUrl,
                detail: 'milanuncios session warm-up failed (GeeTest likely)',
            });
            return [];
        }
        finally {
            await session?.close();
        }
    }
    async fetch(ref, ctx) {
        if (!(0, classifieds_1.isHousingCategoryUrl)(ref.url, fixtures_1.MILANUNCIOS_HOUSING_CATEGORY_SLUGS) && !ref.url.includes('inmobiliaria')) {
            // Still allow detail URLs that embed the id but carry housing hints in path.
            if (!/piso|casa|chalet|habitacion|atico|duplex|inmueble|alquiler|venta/i.test(ref.url)) {
                throw new Error(`milanuncios: refuse fetch of non-housing URL ${ref.url}`);
            }
        }
        if (!ctx.runtime.openBrowserSession) {
            throw new Error('milanuncios: fetch requires openBrowserSession (GeeTest)');
        }
        const start = Date.now();
        const session = await ctx.runtime.openBrowserSession({
            warmUrl: ref.url,
            signal: ctx.signal,
            contentSelector: 'h1, article, main',
            isChallenge: isMilanunciosChallenge,
            challengeWaitMs: 45000,
            blockAssets: true,
        });
        try {
            // Prefer detail JSON if an API sibling exists; fall back to parsing __NEXT_DATA__ / embedded JSON.
            const apiCandidates = [
                `${fixtures_1.MILANUNCIOS_BASE_URL}/api/v3/adverts/${ref.sourceId}`,
                `${fixtures_1.MILANUNCIOS_BASE_URL}/api/v2/adverts/${ref.sourceId}`,
            ];
            for (const apiUrl of apiCandidates) {
                const { status, body } = await session.request(apiUrl, {
                    referer: ref.url,
                    timeoutMs: 20000,
                });
                if (status >= 200 && status < 300 && body.trim().startsWith('{') && !isMilanunciosChallenge(body)) {
                    const payload = (0, parse_1.parseMilanunciosAdvert)(JSON.parse(body), ref.url);
                    this.metrics.record({
                        provider: this.id,
                        strategy: 'browser',
                        outcome: 'success',
                        status,
                        latencyMs: Date.now() - start,
                        url: apiUrl,
                    });
                    return { ref, payload };
                }
            }
            const html = await session.content();
            if (isMilanunciosChallenge(html)) {
                throw new Error('milanuncios: detail page still challenged');
            }
            // Last resort: look for embedded JSON advert blob.
            const embedded = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
            if (embedded) {
                const next = JSON.parse(embedded);
                const advert = next.props?.pageProps?.advert;
                if (advert) {
                    return { ref, payload: (0, parse_1.parseMilanunciosAdvert)(advert, ref.url) };
                }
            }
            throw new Error(`milanuncios: no JSON advert payload for ${ref.sourceId}`);
        }
        finally {
            await session.close();
        }
    }
    normalize(raw) {
        return (0, parse_1.normalizeMilanunciosRaw)(asMilanunciosRaw(raw.payload));
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
            detail: `Serving ES housing-only via ${fixtures_1.MILANUNCIOS_BASE_URL} (GeeTest; OFF until verified)`,
        };
    }
}
exports.MilanunciosProvider = MilanunciosProvider;
