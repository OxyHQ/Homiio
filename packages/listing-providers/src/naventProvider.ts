/**
 * Shared Navent {@link ListingProvider} factory (Zonaprop / Plusvalía / Argenprop).
 *
 * JSON/AJAX first (`rplis-api/postings`) via warmed Playwright session; HTML
 * `__PRELOADED_STATE__` / JSON-LD fallback. Portal modules only supply site config.
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
import { citySlug } from './slug';
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
import {
  isNaventChallenge,
  naventPostingDetailApiUrls,
  naventPostingsApiUrl,
  parseNaventDetail,
  parseNaventPostingJson,
  parseNaventSearch,
  parseNaventSearchJson,
  type NaventRawListing,
  type NaventSiteConfig,
} from './navent';

const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR = 'a[href*="/propiedades/"], a[href*=".html"], script, main, h1';

export interface NaventProviderFactoryOptions {
  id: ProviderId;
  markets: ReadonlyArray<ListingMarket>;
  site: NaventSiteConfig;
  /** Default discover cities when job/env omit them. */
  defaultCities: readonly string[];
  /** Locale for Playwright (e.g. `es-AR`). */
  locale: string;
  acceptLanguage: string;
  /** Country display name for normalize(). */
  countryName: string;
  /**
   * Build a search URL for city + page + operation.
   * Default: `{base}/departamentos-{kind}-{city}.html?pagina=`
   */
  searchUrl?: (city: string, page: number, kind: 'alquiler' | 'venta') => string;
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function defaultSearchUrl(
  site: NaventSiteConfig,
  city: string,
  page: number,
  kind: 'alquiler' | 'venta',
): string {
  const slug = citySlug(city);
  const base = `${site.baseUrl}/departamentos-${kind}-${slug}.html`;
  return page <= 1 ? base : `${base}?pagina=${page}`;
}

function resolvePropertyType(raw: string | undefined): PropertyType {
  const lower = (raw ?? '').toLowerCase();
  if (/casa|house|chalet|ph\b/.test(lower)) return PropertyType.HOUSE;
  if (/studio|estudio|monoambiente/.test(lower)) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function asRaw(provider: string, payload: unknown): NaventRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error(`${provider}: normalize received an invalid payload`);
  }
  return payload as NaventRawListing;
}

export function createNaventProvider(options: NaventProviderFactoryOptions): ListingProvider {
  const runtime = options.runtime ?? createFetchRuntime();
  const cities =
    options.cities && options.cities.length > 0 ? options.cities : options.defaultCities;
  const metrics = options.metrics ?? defaultProviderMetrics;
  const buildSearch = options.searchUrl ?? ((city, page, kind) => defaultSearchUrl(options.site, city, page, kind));

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

      for (const city of jobCities) {
        for (const kind of ['alquiler', 'venta'] as const) {
          for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
            if (yielded >= limit) return;
            const refs = await discoverPage(rt, city, kind, page, job.signal);
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
      if (!ctx.runtime.openBrowserSession) {
        throw new Error(`${options.id}: fetch requires openBrowserSession (Cloudflare)`);
      }
      const sticky = envBool('LISTING_PROXY_STICKY', false);
      if (sticky && !stickyProxySessionId) stickyProxySessionId = createProxySessionId();

      let session: BrowserSession | undefined;
      const start = Date.now();
      try {
        session = await ctx.runtime.openBrowserSession({
          warmUrl: ref.url,
          signal: ctx.signal,
          contentSelector: CONTENT_SELECTOR,
          isChallenge: isNaventChallenge,
          challengeWaitMs: 60_000,
          stickyProxySession: sticky,
          proxySessionId: stickyProxySessionId,
          storageState: stickyStorageState,
          blockAssets: true,
          locale: options.locale,
          acceptLanguage: options.acceptLanguage,
        });

        for (const apiUrl of naventPostingDetailApiUrls(options.site, ref.sourceId)) {
          try {
            const { status, body } = await session.request(apiUrl, {
              referer: ref.url,
              timeoutMs: 20_000,
            });
            if (
              status >= 200 &&
              status < 300 &&
              body.trim().startsWith('{') &&
              !isNaventChallenge(body)
            ) {
              const payload = parseNaventPostingJson(options.site, body, ref.url);
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
            // Try next / HTML.
          }
        }

        const html = await session.content();
        if (isNaventChallenge(html)) {
          throw new Error(`${options.id}: detail still challenged`);
        }
        const payload = parseNaventDetail(options.site, html, ref.url);
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
      } finally {
        await session?.close();
      }
    },

    normalize(raw: RawListing): NormalizedListing {
      const listing = asRaw(options.id, raw.payload);
      const isSale = listing.operation === 'sale';
      const result: NormalizedListing = {
        source: options.id,
        sourceId: listing.sourceId,
        sourceUrl: listing.url,
        address: {
          street: listing.address.street ?? listing.address.city,
          city: listing.address.city,
          state: listing.address.region,
          country: options.countryName,
          countryCode: listing.address.countryCode,
          coordinates: listing.coordinates,
        },
        type: resolvePropertyType(listing.propertyType),
        offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
        longTermRent: isSale
          ? undefined
          : { monthlyAmount: listing.price, currency: listing.currency },
        sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
        remoteImages: toRemoteImages(listing.images),
        status: 'published',
      };
      if (listing.description) result.description = listing.description;
      else if (listing.title) result.description = listing.title;
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
        detail: `Serving ${options.markets.join(',')} via ${options.site.baseUrl} (Navent JSON + session)`,
      };
    },
  };

  async function discoverPage(
    rt: FetchRuntime,
    city: string,
    kind: 'alquiler' | 'venta',
    page: number,
    signal?: AbortSignal,
  ): Promise<ExternalListingRef[]> {
    if (!rt.openBrowserSession) return [];
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !stickyProxySessionId) stickyProxySessionId = createProxySessionId();

    const warmUrl = buildSearch(city, page, kind);
    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await rt.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isNaventChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: stickyProxySessionId,
        storageState: stickyStorageState,
        blockAssets: true,
        locale: options.locale,
        acceptLanguage: options.acceptLanguage,
      });

      const apiUrl = naventPostingsApiUrl(options.site);
      let refs: ExternalListingRef[] = [];
      try {
        const { status, body } = await session.request(apiUrl, {
          referer: warmUrl,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          timeoutMs: 30_000,
        });
        if (status >= 200 && status < 300 && !isNaventChallenge(body)) {
          refs = parseNaventSearchJson(options.site, body).map((ref) => ({
            provider: options.id,
            sourceId: ref.sourceId,
            url: ref.url,
          }));
        }
      } catch {
        // Fall through to preloaded HTML.
      }

      if (refs.length === 0) {
        const html = await session.content();
        if (!isNaventChallenge(html)) {
          refs = parseNaventSearch(options.site, html).map((ref) => ({
            provider: options.id,
            sourceId: ref.sourceId,
            url: ref.url,
          }));
        }
      }

      metrics.record({
        provider: options.id,
        strategy: 'browser',
        outcome: refs.length > 0 ? 'success' : 'challenge',
        status: 200,
        latencyMs: Date.now() - start,
        url: warmUrl,
      });
      if (sticky) stickyStorageState = await session.exportStorageState();
      return refs;
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

  return provider;
}
