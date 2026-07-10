"use strict";
/**
 * yaencontre.com provider — JSON/AJAX via Playwright session; HTML last resort.
 * Registered OFF (`PROVIDER_YAENCONTRE_ENABLED`). Cloudflare currently blocks
 * cold + proxy sessions; keep OFF until managed tier or session clears.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.YaencontreProvider = void 0;
exports.isYaencontreChallenge = isYaencontreChallenge;
const runtime_1 = require("../../runtime");
const metrics_1 = require("../../metrics");
const fixtures_1 = require("./fixtures");
const parse_1 = require("./parse");
const PROVIDER_ID = 'yaencontre';
const DEFAULT_CITIES = ['madrid', 'barcelona', 'valencia'];
const MAX_SEARCH_PAGES = 3;
function isYaencontreChallenge(body) {
    if (body.trim().length < 512)
        return true;
    return /just a moment|cloudflare|cf-browser|captcha|access denied|datadome/i.test(body);
}
function asRaw(payload) {
    const record = payload;
    if (!record || typeof record.sourceId !== 'string' || typeof record.price !== 'number') {
        throw new Error('yaencontre: normalize received an invalid payload');
    }
    return payload;
}
class YaencontreProvider {
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
        if (!runtime.openBrowserSession)
            return;
        for (const city of cities) {
            for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
                if (yielded >= limit)
                    return;
                const warmUrl = (0, fixtures_1.yaencontreSearchUrl)(city, page);
                let session;
                const start = Date.now();
                try {
                    session = await runtime.openBrowserSession({
                        warmUrl,
                        signal: job.signal,
                        contentSelector: 'article, main, h1',
                        isChallenge: isYaencontreChallenge,
                        challengeWaitMs: 45000,
                        blockAssets: true,
                    });
                    const ajaxUrl = (0, fixtures_1.yaencontreListAjaxUrl)(city, page);
                    const { status, body } = await session.request(ajaxUrl, {
                        referer: session.pageUrl(),
                        timeoutMs: 30000,
                    });
                    if (status >= 400 || isYaencontreChallenge(body)) {
                        this.metrics.record({
                            provider: this.id,
                            strategy: 'browser',
                            outcome: 'challenge',
                            status,
                            latencyMs: Date.now() - start,
                            url: ajaxUrl,
                        });
                        break;
                    }
                    const refs = (0, parse_1.parseYaencontreSearchJson)(body);
                    this.metrics.record({
                        provider: this.id,
                        strategy: 'browser',
                        outcome: 'success',
                        status,
                        latencyMs: Date.now() - start,
                        url: ajaxUrl,
                    });
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
                catch {
                    this.metrics.record({
                        provider: this.id,
                        strategy: 'browser',
                        outcome: 'challenge',
                        latencyMs: Date.now() - start,
                        url: warmUrl,
                    });
                    break;
                }
                finally {
                    await session?.close();
                }
            }
        }
    }
    async fetch(ref, ctx) {
        if (!ctx.runtime.openBrowserSession) {
            throw new Error('yaencontre: fetch requires openBrowserSession');
        }
        const session = await ctx.runtime.openBrowserSession({
            warmUrl: ref.url,
            signal: ctx.signal,
            contentSelector: 'h1, main',
            isChallenge: isYaencontreChallenge,
            challengeWaitMs: 45000,
            blockAssets: true,
        });
        try {
            const apiUrl = `${fixtures_1.YAENCONTRE_BASE_URL}/api/listing/${ref.sourceId}`;
            const { status, body } = await session.request(apiUrl, {
                referer: ref.url,
                timeoutMs: 20000,
            });
            if (status >= 200 && status < 300 && body.trim().startsWith('{') && !isYaencontreChallenge(body)) {
                return { ref, payload: (0, parse_1.parseYaencontreDetailJson)(JSON.parse(body), ref.url) };
            }
            throw new Error(`yaencontre: no JSON detail for ${ref.sourceId} (status=${status})`);
        }
        finally {
            await session.close();
        }
    }
    normalize(raw) {
        return (0, parse_1.normalizeYaencontreRaw)(asRaw(raw.payload));
    }
    async health() {
        return {
            provider: this.id,
            status: 'healthy',
            detail: `Serving ES via ${fixtures_1.YAENCONTRE_BASE_URL} (Cloudflare-gated; OFF until session clears)`,
        };
    }
}
exports.YaencontreProvider = YaencontreProvider;
