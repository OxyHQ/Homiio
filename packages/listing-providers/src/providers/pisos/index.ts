/**
 * pisos.com provider (Spain) — JSON-first.
 *
 * Acquisition:
 *   - `discover()`: cold HTTP JSON-LD search pages first; optional warmed session
 *     when the ladder challenges (one sticky session per city, `warmNavigate` pages).
 *   - `fetch()`: detail page embedded JSON (`data-var` + tracking blob) for price /
 *     rooms / m² / phone; best-effort `/WebsiteUserInfo/GetNormalizedPhone` AJAX.
 *   - HTML is last-resort for title/images/description only.
 *
 * Registered OFF by default (`PROVIDER_PISOS_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type {
  DiscoverJob,
  ExternalListingRef,
  FetchContext,
  FetchRuntime,
  ListingProvider,
  ProviderHealth,
  RawListing,
} from '../../types';
import { createFetchRuntime } from '../../runtime';
import { fetchListingViaLadder } from '../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../metrics';
import { providerMaxSearchPages } from '../../discoverLimits';
import type { EsSchemaListing } from '../../parse/jsonLd';
import { createProxySessionId, envBool } from '../../proxy';
import type { BrowserSession, BrowserStorageState } from '../../browserSession';
import { PISOS_BASE_URL } from './fixtures';
import { parsePisosContactPhone, pisosContactPhoneUrl, pisosSearchUrl } from './ajax';
import {
  mergePisosContact,
  parsePisosDetail,
  parsePisosSearch,
  pisosSourceIdFromUrl,
  type PisosRaw,
} from './parse';
import {
  pisosBrowserSessionHints,
  readPisosBrowserSessionHint,
  type PisosBrowserSessionHint,
} from './sessionHints';

import { pisosCitiesFromEnv } from './cities';

export { pisosCitiesFromEnv, pisosCitiesOptionsFromEnv } from './cities';

const PROVIDER_ID: ProviderId = 'pisos';
const ES_PROXY_COUNTRY = 'es';
const DEFAULT_MAX_SEARCH_PAGES = 50;
const PISOS_SEARCH_CONTENT_SELECTOR = 'script[type="application/ld+json"], [href*="/alquilar/"]';

export function isPisosChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /access denied|captcha|datadome|precondition failed/i.test(html);
}

export interface PisosProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function resolvePropertyType(types: readonly string[]): PropertyType {
  const lower = types.map((type) => type.toLowerCase());
  if (lower.some((type) => type.includes('house') || type.includes('chalet'))) return PropertyType.HOUSE;
  if (lower.some((type) => type.includes('studio'))) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(listing: EsSchemaListing): NormalizedRemoteImage[] {
  return listing.images.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function asPisosRaw(payload: unknown): PisosRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; listing?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    !record.listing ||
    typeof record.listing !== 'object'
  ) {
    throw new Error('pisos: normalize received a payload that is not a PisosRaw');
  }
  return payload as PisosRaw;
}

function yieldRefs(
  refs: readonly { sourceId: string; url: string }[],
  seen: Set<string>,
  limit: number,
  yielded: { count: number },
  browserSession?: PisosBrowserSessionHint,
): ExternalListingRef[] {
  const out: ExternalListingRef[] = [];
  const hints = browserSession ? pisosBrowserSessionHints(browserSession) : undefined;
  for (const ref of refs) {
    if (yielded.count >= limit) break;
    if (seen.has(ref.sourceId)) continue;
    seen.add(ref.sourceId);
    out.push({ provider: PROVIDER_ID, sourceId: ref.sourceId, url: ref.url, hints });
    yielded.count += 1;
  }
  return out;
}

export class PisosProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private readonly maxSearchPages: number;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: PisosProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : pisosCitiesFromEnv();
    this.metrics = options.metrics ?? defaultProviderMetrics;
    this.maxSearchPages = providerMaxSearchPages(PROVIDER_ID, DEFAULT_MAX_SEARCH_PAGES, 'ES');
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    const yielded = { count: 0 };
    const runtime = job.runtime ?? this.runtime;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }
    const httpSessionHint: PisosBrowserSessionHint | undefined =
      sticky && this.stickyProxySessionId
        ? { proxySessionId: this.stickyProxySessionId, storageState: this.stickyStorageState }
        : undefined;

    for (const city of cities) {
      if (yielded.count >= limit) return;

      const beforeCity = yielded.count;
      for (let page = 1; page <= this.maxSearchPages; page += 1) {
        if (yielded.count >= limit) return;
        const html = await this.fetchSearchHtml(runtime, city, page, job.signal);
        if (!html) break;

        const refs = parsePisosSearch(html);
        if (refs.length === 0) break;
        for (const ref of yieldRefs(refs, seen, limit, yielded, httpSessionHint)) {
          yield ref;
        }
      }

      if (yielded.count === beforeCity && runtime.openBrowserSession) {
        for await (const ref of this.discoverCityViaSession(
          runtime,
          city,
          job.signal,
          seen,
          limit,
          yielded,
        )) {
          yield ref;
        }
      }
    }
  }

  /** JSON-LD search pages work on cold HTTP — prefer that before any browser warm. */
  private async fetchSearchHtml(
    runtime: FetchRuntime,
    city: string,
    page: number,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    const url = pisosSearchUrl(city, page);
    try {
      const { html, status } = await fetchListingViaLadder(runtime, url, {
        provider: this.id,
        isChallenge: isPisosChallenge,
        metrics: this.metrics,
        init: { signal, proxyCountry: ES_PROXY_COUNTRY },
        tiers: ['http', 'browser'],
      });
      if (status >= 400 || isPisosChallenge(html)) return undefined;
      return html;
    } catch {
      return undefined;
    }
  }

  private pisosSessionOptions(city: string, page: number, sticky: boolean) {
    return {
      warmUrl: pisosSearchUrl(city, page),
      contentSelector: PISOS_SEARCH_CONTENT_SELECTOR,
      isChallenge: isPisosChallenge,
      stickyProxySession: sticky,
      proxySessionId: this.stickyProxySessionId,
      storageState: this.stickyStorageState,
      blockAssets: true,
      postChallengeSettleMs: 1_000,
      proxyCountry: ES_PROXY_COUNTRY,
    } as const;
  }

  private async *discoverCityViaSession(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): AsyncIterable<ExternalListingRef> {
    if (!runtime.openBrowserSession) return;

    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }

    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        ...this.pisosSessionOptions(city, 1, sticky),
        signal,
      });

      for (let page = 1; page <= this.maxSearchPages; page += 1) {
        if (yielded.count >= limit) return;

        if (page > 1) {
          await session.warmNavigate({
            ...this.pisosSessionOptions(city, page, sticky),
            signal,
          });
        }

        const html = await session.content();
        if (isPisosChallenge(html)) break;

        const refs = parsePisosSearch(html);
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'success',
          status: 200,
          latencyMs: Date.now() - start,
          url: pisosSearchUrl(city, page),
        });
        if (refs.length === 0) break;
        const browserSession: PisosBrowserSessionHint = {
          proxySessionId: this.stickyProxySessionId,
          storageState: sticky ? await session.exportStorageState() : undefined,
        };
        for (const ref of yieldRefs(refs, seen, limit, yielded, browserSession)) {
          yield ref;
        }
      }

      if (sticky) {
        this.stickyStorageState = await session.exportStorageState();
      }
    } catch {
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'error',
        latencyMs: Date.now() - start,
        url: pisosSearchUrl(city, 1),
        detail: 'pisos search session warm-up failed',
      });
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const discoverSession = readPisosBrowserSessionHint(ref.hints);
    const fromSession = await this.fetchDetailViaSession(ref, ctx, discoverSession);
    if (fromSession) return fromSession;

    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isPisosChallenge,
      init: { signal: ctx.signal, proxyCountry: ES_PROXY_COUNTRY },
      metrics: this.metrics,
      tiers: ['http', 'browser', 'managed'],
    });
    let payload = parsePisosDetail(html, ref.url);
    payload = await this.enrichPisosContact(ref, ctx, payload, discoverSession);
    return { ref, payload };
  }

  private async fetchDetailViaSession(
    ref: ExternalListingRef,
    ctx: FetchContext,
    discoverSession: PisosBrowserSessionHint | undefined,
  ): Promise<RawListing | undefined> {
    if (!ctx.runtime.openBrowserSession) return undefined;

    const sticky = envBool('LISTING_PROXY_STICKY', false);
    let proxySessionId = discoverSession?.proxySessionId ?? this.stickyProxySessionId;
    if (sticky && !proxySessionId) {
      proxySessionId = createProxySessionId();
      this.stickyProxySessionId = proxySessionId;
    }
    const storageState = discoverSession?.storageState ?? this.stickyStorageState;

    let session: BrowserSession | undefined;
    try {
      session = await ctx.runtime.openBrowserSession({
        warmUrl: ref.url,
        signal: ctx.signal,
        contentSelector: 'h1, #hdnIdPiso, script[type="application/ld+json"]',
        isChallenge: isPisosChallenge,
        stickyProxySession: sticky,
        proxySessionId,
        storageState,
        blockAssets: true,
        postChallengeSettleMs: 500,
        proxyCountry: ES_PROXY_COUNTRY,
        challengeWaitMs: discoverSession ? 20_000 : 45_000,
      });
      const html = await session.content();
      if (isPisosChallenge(html)) return undefined;
      let payload = parsePisosDetail(html, ref.url);
      payload = await this.enrichPisosContact(ref, ctx, payload, discoverSession, session);
      if (sticky) {
        this.stickyStorageState = await session.exportStorageState();
      }
      return { ref, payload };
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  private async enrichPisosContact(
    ref: ExternalListingRef,
    ctx: FetchContext,
    payload: PisosRaw,
    discoverSession: PisosBrowserSessionHint | undefined,
    existingSession?: BrowserSession,
  ): Promise<PisosRaw> {
    try {
      const contactUrl = pisosContactPhoneUrl(payload.sourceId);
      if (existingSession) {
        const { status, body } = await existingSession.request(contactUrl, {
          referer: ref.url,
          timeoutMs: 15_000,
          headers: { Accept: 'application/json' },
        });
        if (status >= 200 && status < 300) {
          return mergePisosContact(payload, parsePisosContactPhone(body));
        }
      } else if (ctx.runtime.openBrowserSession) {
        const sticky = envBool('LISTING_PROXY_STICKY', false);
        let proxySessionId = discoverSession?.proxySessionId ?? this.stickyProxySessionId;
        if (sticky && !proxySessionId) {
          proxySessionId = createProxySessionId();
          this.stickyProxySessionId = proxySessionId;
        }
        const session = await ctx.runtime.openBrowserSession({
          warmUrl: ref.url,
          signal: ctx.signal,
          contentSelector: 'h1, #hdnIdPiso',
          isChallenge: isPisosChallenge,
          stickyProxySession: sticky,
          proxySessionId,
          storageState: discoverSession?.storageState ?? this.stickyStorageState,
          blockAssets: true,
          postChallengeSettleMs: 500,
          proxyCountry: ES_PROXY_COUNTRY,
        });
        try {
          const { status, body } = await session.request(contactUrl, {
            referer: ref.url,
            timeoutMs: 15_000,
            headers: { Accept: 'application/json' },
          });
          if (status >= 200 && status < 300) {
            return mergePisosContact(payload, parsePisosContactPhone(body));
          }
        } finally {
          await session.close();
        }
      } else {
        const { body } = await ctx.runtime.fetchHttp(contactUrl, {
          headers: {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: ref.url,
          },
          signal: ctx.signal,
          proxyCountry: ES_PROXY_COUNTRY,
        });
        return mergePisosContact(payload, parsePisosContactPhone(body));
      }
    } catch {
      // Contact is optional; embedded `data-var` phone already on payload when present.
    }
    return payload;
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, listing, contact } = asPisosRaw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`pisos: listing ${sourceId} has no resolvable price`);
    }
    const isSale = listing.operation === 'sale';
    const currency = listing.priceCurrency ?? 'EUR';

    const result: NormalizedListing = {
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
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency },
      sale: isSale ? { price: listing.price, currency } : undefined,
      remoteImages: toRemoteImages(listing),
      status: 'published',
    };

    const description = listing.description ?? listing.name;
    if (description !== undefined) result.description = description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.amenities.length > 0) result.amenities = listing.amenities;
    if (contact && (contact.phone || contact.email || contact.whatsapp || contact.agencyName)) {
      result.contact = contact;
    }

    return result;
  }

  async health(): Promise<ProviderHealth> {
    const snapshot = this.metrics.snapshot(this.id);
    if (snapshot && snapshot.attempts > 0) {
      const status =
        snapshot.challengeRate >= 0.8 ? 'unhealthy' : snapshot.challengeRate >= 0.3 ? 'degraded' : 'healthy';
      return {
        provider: this.id,
        status,
        detail: `attempts=${snapshot.attempts} challengeRate=${snapshot.challengeRate.toFixed(2)} avgLatencyMs=${snapshot.avgLatencyMs}`,
      };
    }
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving ES via ${PISOS_BASE_URL} (HTTP JSON-LD discover + embedded detail JSON)`,
    };
  }
}

export { pisosSourceIdFromUrl };
