/**
 * Shared MercadoLibre inmuebles {@link ListingProvider} factory (MLA / MEC / …).
 *
 * Housing-only discover URLs; JSON item API when reachable from a warmed session;
 * HTML JSON-LD / VIP fields / card hrefs otherwise. Classifieds guards via
 * {@link ./classifieds} + {@link ./mercadolibre}.
 */

import {
  OfferingType,
  PropertyType,
  type ListingMarket,
  type NormalizedListing,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from './browserSession';
import { BrowserSessionChallengeError } from './session';
import { createProxySessionId, envBool } from './proxy';
import { isHousingCategoryUrl } from './classifieds';
import type {
  DiscoverJob,
  ExternalListingRef,
  FetchContext,
  FetchRuntime,
  ListingProvider,
  ProviderHealth,
  RawListing,
} from './types';
import { createFetchRuntime } from './runtime';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from './metrics';
import { ChallengeError, fetchListingViaLadder } from './strategy';
import {
  isMercadolibreChallenge,
  mercadolibreHousingSearchUrl,
  mercadolibreItemApiUrl,
  parseMercadolibreDetail,
  parseMercadolibreItemJson,
  parseMercadolibreSearch,
  type MercadolibreRawListing,
  type MercadolibreSiteConfig,
} from './mercadolibre';

const MAX_SEARCH_PAGES = 3;

export interface MercadolibreProviderFactoryOptions {
  id: ProviderId;
  markets: ReadonlyArray<ListingMarket>;
  site: MercadolibreSiteConfig;
  defaultCities: readonly string[];
  locale: string;
  acceptLanguage: string;
  countryName: string;
  /** Prefer browser session; when absent, ladder HTML for markets that allow cold HTTP. */
  requireBrowserSession?: boolean;
  contentSelector?: string;
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(provider: string, payload: unknown): MercadolibreRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error(`${provider}: normalize received an invalid payload`);
  }
  return payload as MercadolibreRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function resolvePropertyType(raw: MercadolibreRawListing): PropertyType {
  const lower = `${raw.propertyType ?? ''} ${raw.domainId ?? ''} ${raw.title ?? ''}`.toLowerCase();
  if (/casa|house|ph\b|quinta/.test(lower)) return PropertyType.HOUSE;
  if (/studio|monoambiente|estudio/.test(lower)) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

export function createMercadolibreProvider(
  options: MercadolibreProviderFactoryOptions,
): ListingProvider {
  const runtime = options.runtime ?? createFetchRuntime();
  const cities =
    options.cities && options.cities.length > 0 ? options.cities : options.defaultCities;
  const metrics = options.metrics ?? defaultProviderMetrics;
  const requireBrowser = options.requireBrowserSession !== false;
  const contentSelector =
    options.contentSelector ??
    `ol.ui-search-layout, a[href*="${options.site.siteId}-"], script, main, .poly-card`;

  let stickyProxySessionId: string | undefined;
  let stickyStorageState: BrowserStorageState | undefined;

  const provider: ListingProvider = {
    id: options.id,
    markets: options.markets,

    async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
      const jobCities = job.city ? [job.city] : cities;
      const limit = job.limit ?? Number.POSITIVE_INFINITY;
      const seen = new Set<string>();
      let yielded = 0;
      const rt = job.runtime ?? runtime;

      const rentSegment = options.site.rentSegment ?? 'alquiler';
      const operations: readonly ('alquiler' | 'arriendo' | 'renta' | 'venta')[] =
        rentSegment === 'alquiler' ? ['alquiler', 'venta'] : [rentSegment, 'venta'];

      for (const city of jobCities) {
        for (const kind of operations) {
          for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
            if (yielded >= limit) return;
            const warmUrl = mercadolibreHousingSearchUrl(options.site, city, page, kind);
            if (!isHousingCategoryUrl(warmUrl, options.site.housingSlugs)) {
              throw new Error(`${options.id}: refuse non-housing discover URL ${warmUrl}`);
            }
            const refs = await discoverPage(rt, warmUrl, job.signal);
            if (refs.length === 0) break;
            for (const ref of refs) {
              if (yielded >= limit) return;
              if (seen.has(ref.sourceId)) continue;
              seen.add(ref.sourceId);
              yield { provider: options.id, sourceId: ref.sourceId, url: ref.url };
              yielded += 1;
            }
          }
        }
      }
    },

    async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
      if (ctx.runtime.openBrowserSession) {
        const fromSession = await fetchViaSession(ref, ctx);
        if (fromSession) return fromSession;
      }
      if (requireBrowser && !ctx.runtime.openBrowserSession) {
        throw new Error(`${options.id}: fetch requires openBrowserSession`);
      }
      const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
        provider: options.id,
        isChallenge: isMercadolibreChallenge,
        init: { signal: ctx.signal },
        metrics,
      });
      const payload = parseMercadolibreDetail(options.site, html, ref.url);
      return { ref, payload };
    },

    normalize(raw: RawListing): NormalizedListing {
      const listing = asRaw(options.id, raw.payload);
      const isSale = listing.operation === 'sale';
      const result: NormalizedListing = {
        source: options.id,
        sourceId: listing.sourceId,
        sourceUrl: listing.url,
        address: {
          street: listing.address.street ?? listing.address.neighborhood ?? listing.address.city,
          city: listing.address.city,
          state: listing.address.region,
          country: options.countryName,
          countryCode: listing.address.countryCode,
          neighborhood: listing.address.neighborhood,
        },
        type: resolvePropertyType(listing),
        offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
        longTermRent: isSale
          ? undefined
          : { monthlyAmount: listing.price, currency: listing.currency },
        sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
        remoteImages: toRemoteImages(listing.images),
        status: 'published',
      };
      if (listing.description) result.description = listing.description;
      if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
      if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
      if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
      if (listing.contact) result.contact = listing.contact;
      return result;
    },

    async health(): Promise<ProviderHealth> {
      return {
        provider: options.id,
        status: 'healthy',
        detail: `Serving ${options.markets.join(',')} housing-only via ${options.site.inmueblesBaseUrl}`,
      };
    },
  };

  async function discoverPage(
    rt: FetchRuntime,
    warmUrl: string,
    signal?: AbortSignal,
  ): Promise<ExternalListingRef[]> {
    if (rt.openBrowserSession) {
      const sticky = envBool('LISTING_PROXY_STICKY', false);
      if (sticky && !stickyProxySessionId) stickyProxySessionId = createProxySessionId();
      let session: BrowserSession | undefined;
      const start = Date.now();
      try {
        session = await rt.openBrowserSession({
          warmUrl,
          signal,
          contentSelector,
          isChallenge: isMercadolibreChallenge,
          challengeWaitMs: 60_000,
          stickyProxySession: sticky,
          proxySessionId: stickyProxySessionId,
          storageState: stickyStorageState,
          blockAssets: true,
          locale: options.locale,
          acceptLanguage: options.acceptLanguage,
        });
        const html = await session.content();
        if (isMercadolibreChallenge(html)) {
          metrics.record({
            provider: options.id,
            strategy: 'browser',
            outcome: 'challenge',
            latencyMs: Date.now() - start,
            url: warmUrl,
          });
          return [];
        }
        const refs = parseMercadolibreSearch(options.site, html);
        metrics.record({
          provider: options.id,
          strategy: 'browser',
          outcome: refs.length > 0 ? 'success' : 'error',
          status: 200,
          latencyMs: Date.now() - start,
          url: warmUrl,
        });
        if (sticky) stickyStorageState = await session.exportStorageState();
        return refs.map((ref) => ({
          provider: options.id,
          sourceId: ref.sourceId,
          url: ref.url,
        }));
      } catch (error) {
        const detail =
          error instanceof BrowserSessionChallengeError
            ? error.detail
            : error instanceof Error
              ? error.message
              : String(error);
        metrics.record({
          provider: options.id,
          strategy: 'browser',
          outcome: 'challenge',
          latencyMs: Date.now() - start,
          url: warmUrl,
          detail,
        });
        return [];
      } finally {
        await session?.close();
      }
    }

    if (requireBrowser) return [];

    try {
      const { html } = await fetchListingViaLadder(rt, warmUrl, {
        provider: options.id,
        isChallenge: isMercadolibreChallenge,
        metrics,
      });
      return parseMercadolibreSearch(options.site, html).map((ref) => ({
        provider: options.id,
        sourceId: ref.sourceId,
        url: ref.url,
      }));
    } catch (error) {
      if (error instanceof ChallengeError) return [];
      throw error;
    }
  }

  async function fetchViaSession(
    ref: ExternalListingRef,
    ctx: FetchContext,
  ): Promise<RawListing | undefined> {
    if (!ctx.runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !stickyProxySessionId) stickyProxySessionId = createProxySessionId();

    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await ctx.runtime.openBrowserSession({
        warmUrl: ref.url,
        signal: ctx.signal,
        contentSelector,
        isChallenge: isMercadolibreChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: stickyProxySessionId,
        storageState: stickyStorageState,
        blockAssets: true,
        locale: options.locale,
        acceptLanguage: options.acceptLanguage,
      });

      const apiUrl = mercadolibreItemApiUrl(options.site, ref.sourceId);
      try {
        const { status, body } = await session.request(apiUrl, {
          referer: ref.url,
          timeoutMs: 20_000,
        });
        if (status >= 200 && status < 300 && body.trim().startsWith('{')) {
          const payload = parseMercadolibreItemJson(options.site, body, ref.url);
          metrics.record({
            provider: options.id,
            strategy: 'browser',
            outcome: 'success',
            status,
            latencyMs: Date.now() - start,
            url: apiUrl,
          });
          if (sticky) stickyStorageState = await session.exportStorageState();
          return { ref, payload };
        }
      } catch {
        // HTML fallback.
      }

      const html = await session.content();
      if (isMercadolibreChallenge(html)) return undefined;
      const payload = parseMercadolibreDetail(options.site, html, ref.url);
      metrics.record({
        provider: options.id,
        strategy: 'browser',
        outcome: 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url: ref.url,
      });
      if (sticky) stickyStorageState = await session.exportStorageState();
      return { ref, payload };
    } catch (error) {
      if (error instanceof Error && /non-housing|rejecting/i.test(error.message)) throw error;
      return undefined;
    } finally {
      await session?.close();
    }
  }

  return provider;
}
