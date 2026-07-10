"use strict";
/**
 * pisos.com provider (Spain) — JSON-first.
 *
 * Acquisition:
 *   - `discover()`: city rental search pages → schema.org JSON-LD cards (structured
 *     listing refs). Optional Playwright session warm-up when the ladder challenges.
 *   - `fetch()`: detail page embedded JSON (`data-var` + tracking blob) for price /
 *     rooms / m² / phone; best-effort `/WebsiteUserInfo/GetNormalizedPhone` AJAX.
 *   - HTML is last-resort for title/images/description only.
 *
 * Registered OFF by default (`PROVIDER_PISOS_ENABLED`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pisosSourceIdFromUrl = exports.PisosProvider = void 0;
exports.isPisosChallenge = isPisosChallenge;
const shared_types_1 = require("@homiio/shared-types");
const runtime_1 = require("../../runtime");
const strategy_1 = require("../../strategy");
const metrics_1 = require("../../metrics");
const fixtures_1 = require("./fixtures");
const ajax_1 = require("./ajax");
const parse_1 = require("./parse");
Object.defineProperty(exports, "pisosSourceIdFromUrl", { enumerable: true, get: function () { return parse_1.pisosSourceIdFromUrl; } });
const PROVIDER_ID = 'pisos';
const DEFAULT_CITIES = ['madrid', 'barcelona', 'valencia', 'sevilla', 'malaga'];
const MAX_SEARCH_PAGES = 3;
function isPisosChallenge(html) {
    if (html.trim().length < 512)
        return true;
    return /access denied|captcha|datadome|precondition failed/i.test(html);
}
function resolvePropertyType(types) {
    const lower = types.map((type) => type.toLowerCase());
    if (lower.some((type) => type.includes('house') || type.includes('chalet')))
        return shared_types_1.PropertyType.HOUSE;
    if (lower.some((type) => type.includes('studio')))
        return shared_types_1.PropertyType.STUDIO;
    return shared_types_1.PropertyType.APARTMENT;
}
function toRemoteImages(listing) {
    return listing.images.map((url, index) => ({ url, isPrimary: index === 0 }));
}
function asPisosRaw(payload) {
    const record = payload;
    if (!record ||
        typeof record.sourceId !== 'string' ||
        typeof record.url !== 'string' ||
        typeof record.listing !== 'object') {
        throw new Error('pisos: normalize received a payload that is not a PisosRaw');
    }
    return payload;
}
class PisosProvider {
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
                const url = (0, ajax_1.pisosSearchUrl)(city, page);
                // Prefer warmed-session fetch when available (JSON-LD still in HTML shell).
                let html;
                if (runtime.openBrowserSession) {
                    html = await this.fetchSearchViaSession(runtime, url, job.signal);
                }
                if (!html) {
                    const result = await (0, strategy_1.fetchListingViaLadder)(runtime, url, {
                        provider: this.id,
                        isChallenge: isPisosChallenge,
                        metrics: this.metrics,
                        init: { signal: job.signal },
                    });
                    html = result.html;
                }
                const refs = (0, parse_1.parsePisosSearch)(html);
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
    async fetchSearchViaSession(runtime, url, signal) {
        if (!runtime.openBrowserSession)
            return undefined;
        const start = Date.now();
        let session;
        try {
            session = await runtime.openBrowserSession({
                warmUrl: url,
                signal,
                contentSelector: 'script[type="application/ld+json"], h1, main',
                isChallenge: isPisosChallenge,
                challengeWaitMs: 30000,
                blockAssets: true,
            });
            const html = await session.content();
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: isPisosChallenge(html) ? 'challenge' : 'success',
                status: 200,
                latencyMs: Date.now() - start,
                url,
            });
            return isPisosChallenge(html) ? undefined : html;
        }
        catch {
            this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'error',
                latencyMs: Date.now() - start,
                url,
                detail: 'pisos search session warm-up failed',
            });
            return undefined;
        }
        finally {
            await session?.close();
        }
    }
    async fetch(ref, ctx) {
        const { html } = await (0, strategy_1.fetchListingViaLadder)(ctx.runtime, ref.url, {
            provider: this.id,
            isChallenge: isPisosChallenge,
            init: { signal: ctx.signal },
            metrics: this.metrics,
        });
        let payload = (0, parse_1.parsePisosDetail)(html, ref.url);
        // Best-effort contact AJAX — never fail ingest on 403/empty.
        try {
            const contactUrl = (0, ajax_1.pisosContactPhoneUrl)(payload.sourceId);
            if (ctx.runtime.openBrowserSession) {
                const session = await ctx.runtime.openBrowserSession({
                    warmUrl: ref.url,
                    signal: ctx.signal,
                    contentSelector: 'h1, #hdnIdPiso',
                    isChallenge: isPisosChallenge,
                    challengeWaitMs: 20000,
                    blockAssets: true,
                });
                try {
                    const { status, body } = await session.request(contactUrl, {
                        referer: ref.url,
                        timeoutMs: 15000,
                    });
                    if (status >= 200 && status < 300) {
                        payload = (0, parse_1.mergePisosContact)(payload, (0, ajax_1.parsePisosContactPhone)(body));
                    }
                }
                finally {
                    await session.close();
                }
            }
            else {
                const body = await ctx.runtime.fetchText(contactUrl, {
                    headers: {
                        Accept: 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        Referer: ref.url,
                    },
                    signal: ctx.signal,
                });
                payload = (0, parse_1.mergePisosContact)(payload, (0, ajax_1.parsePisosContactPhone)(body));
            }
        }
        catch {
            // Contact is optional.
        }
        return { ref, payload };
    }
    normalize(raw) {
        const { sourceId, url, listing, contact } = asPisosRaw(raw.payload);
        if (listing.price === undefined) {
            throw new Error(`pisos: listing ${sourceId} has no resolvable price`);
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
                country: listing.address.country,
                countryCode: listing.address.countryCode ?? 'ES',
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
        if (contact && (contact.phone || contact.email || contact.whatsapp || contact.agencyName)) {
            result.contact = contact;
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
            detail: `Serving ES via ${fixtures_1.PISOS_BASE_URL} (JSON-LD discover + embedded detail JSON)`,
        };
    }
}
exports.PisosProvider = PisosProvider;
