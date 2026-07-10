/**
 * Fotocasa provider (Spain).
 *
 * Acquisition order (JSON/AJAX first, HTML last):
 *   Discover: warm session → urllocationsegments + searchads AJAX → SSR embed → HTML ladder.
 *   Fetch: warm session → property JSON API → warmed page HTML → ladder HTML.
 *
 * Registered OFF by default (`PROVIDER_FOTOCASA_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../session';
import { BrowserSessionChallengeError } from '../../session';
import { createProxySessionId, envBool } from '../../proxy';
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
import { ChallengeError, fetchListingViaLadder } from '../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../metrics';
import type { EsSchemaListing } from '../../parse/jsonLd';
import { FOTOCASA_BASE_URL } from './fixtures';
import { fotocasaSourceIdFromUrl, parseFotocasaDetail, parseFotocasaSearch, type FotocasaRaw } from './parse';
import {
  fotocasaDefaultLocationSegments,
  fotocasaSearchadsUrl,
  fotocasaUrlLocationSegmentsUrl,
  fotocasaWarmSearchUrl,
  isFotocasaSearchadsChallenge,
  parseFotocasaLocationSegments,
  parseFotocasaSearchads,
  parseFotocasaSsrSearch,
  type FotocasaLocationSegments,
} from './searchads';
import { fotocasaPropertyApiUrl, isFotocasaPropertyChallenge, parseFotocasaPropertyJson } from './property';

const PROVIDER_ID: ProviderId = 'fotocasa';

/** ES cities enumerated when a discover job carries no explicit `city`. */
const DEFAULT_CITIES: readonly string[] = ['madrid', 'barcelona', 'valencia', 'sevilla', 'malaga'];

/** Max search pages paged through per city in one discover pass. */
const MAX_SEARCH_PAGES = 3;

/** Fotocasa content markers after PerimeterX warm-up. */
const FOTOCASA_CONTENT_SELECTOR =
  '.re-Searchresult, .re-CardPackPremium, [data-testid="search-results"], main, h1';

/** HTML markers of a Fotocasa interstitial/anti-bot page served with a 200. */
export function isFotocasaChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /acceso denegado|verifica que eres una persona|datadome|px-captcha|perimeterx|pardon our interruption/i.test(
    html,
  );
}

/** Options for {@link FotocasaProvider}. */
export interface FotocasaProviderOptions {
  /** Runtime used by `discover()` (fetch uses the per-call context runtime). */
  runtime?: FetchRuntime;
  /** Override the default discover city list. */
  cities?: readonly string[];
  /** Metrics sink + reader; defaults to the process-wide store. */
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function searchUrl(city: string, page: number): string {
  return fotocasaWarmSearchUrl(city, page);
}

function resolvePropertyType(types: readonly string[]): PropertyType {
  const lower = types.map((type) => type.toLowerCase());
  if (lower.some((type) => type.includes('house') || type.includes('singlefamily'))) return PropertyType.HOUSE;
  if (lower.some((type) => type.includes('studio'))) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function resolveFurnished(furnished: boolean | undefined): NormalizedListing['furnishedStatus'] {
  if (furnished === true) return 'furnished';
  if (furnished === false) return 'unfurnished';
  return 'not_specified';
}

function toRemoteImages(listing: EsSchemaListing): NormalizedRemoteImage[] {
  return listing.images.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function asFotocasaRaw(payload: unknown): FotocasaRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; listing?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.listing !== 'object'
  ) {
    throw new Error('fotocasa: normalize received a payload that is not a FotocasaRaw');
  }
  return payload as FotocasaRaw;
}

function yieldRefs(
  refs: readonly { sourceId: string; url: string }[],
  seen: Set<string>,
  limit: number,
  yielded: { count: number },
): ExternalListingRef[] {
  const out: ExternalListingRef[] = [];
  for (const ref of refs) {
    if (yielded.count >= limit) break;
    if (seen.has(ref.sourceId)) continue;
    seen.add(ref.sourceId);
    out.push({ provider: PROVIDER_ID, sourceId: ref.sourceId, url: ref.url });
    yielded.count += 1;
  }
  return out;
}

export class FotocasaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: FotocasaProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    const yielded = { count: 0 };
    const runtime = job.runtime ?? this.runtime;

    for (const city of cities) {
      if (yielded.count >= limit) return;

      const viaAjax = runtime.openBrowserSession
        ? await this.discoverCityViaSearchads(runtime, city, job.signal, seen, limit, yielded)
        : [];
      for (const ref of viaAjax) yield ref;
      if (yielded.count >= limit) return;

      if (viaAjax.length === 0) {
        for await (const ref of this.discoverCityViaHtml(runtime, city, job.signal, seen, limit, yielded)) {
          yield ref;
        }
      }
    }
  }

  /**
   * Warm session on city search → urllocationsegments + searchads AJAX pages.
   * Returns refs yielded (empty when warm-up/challenge fails — caller falls back).
   */
  private async discoverCityViaSearchads(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): Promise<ExternalListingRef[]> {
    if (!runtime.openBrowserSession) return [];

    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }

    let session: BrowserSession | undefined;
    const warmUrl = fotocasaWarmSearchUrl(city, 1);
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: FOTOCASA_CONTENT_SELECTOR,
        isChallenge: isFotocasaChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });

      const searchHtml = await session.content();
      let segments: FotocasaLocationSegments | undefined;

      const segmentsUrl = fotocasaUrlLocationSegmentsUrl(city);
      const segmentsRes = await session.request(segmentsUrl, {
        referer: session.pageUrl(),
        timeoutMs: 30_000,
      });
      if (segmentsRes.status < 400 && !isFotocasaSearchadsChallenge(segmentsRes.body)) {
        segments = parseFotocasaLocationSegments(segmentsRes.body);
      }
      if (!segments) {
        segments = fotocasaDefaultLocationSegments(city);
      }

      const collected: ExternalListingRef[] = [];

      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded.count >= limit) break;

        let pageRefs: { sourceId: string; url: string }[];
        let status: number;
        let requestUrl: string;

        if (page === 1) {
          const ssrRefs = parseFotocasaSsrSearch(searchHtml);
          if (ssrRefs.length > 0) {
            pageRefs = ssrRefs;
            status = 200;
            requestUrl = warmUrl;
          } else {
            requestUrl = fotocasaSearchadsUrl(segments, page);
            const response = await session.request(requestUrl, {
              referer: session.pageUrl(),
              timeoutMs: 30_000,
            });
            status = response.status;
            if (
              status === 403 ||
              status === 429 ||
              isFotocasaSearchadsChallenge(response.body)
            ) {
              this.metrics.record({
                provider: this.id,
                strategy: 'browser',
                outcome: 'challenge',
                status,
                latencyMs: Date.now() - start,
                url: requestUrl,
                detail: 'searchads PerimeterX challenge after warm-up',
              });
              break;
            }
            if (status >= 400) break;
            pageRefs = parseFotocasaSearchads(response.body);
          }
        } else {
          requestUrl = fotocasaSearchadsUrl(segments, page);
          const response = await session.request(requestUrl, {
            referer: session.pageUrl(),
            timeoutMs: 30_000,
          });
          status = response.status;
          if (
            status === 403 ||
            status === 429 ||
            isFotocasaSearchadsChallenge(response.body)
          ) {
            this.metrics.record({
              provider: this.id,
              strategy: 'browser',
              outcome: 'challenge',
              status,
              latencyMs: Date.now() - start,
              url: requestUrl,
              detail: 'searchads PerimeterX challenge after warm-up',
            });
            break;
          }
          if (status >= 400) break;
          pageRefs = parseFotocasaSearchads(response.body);
        }

        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'success',
          status,
          latencyMs: Date.now() - start,
          url: requestUrl,
        });
        if (pageRefs.length === 0) break;
        collected.push(...yieldRefs(pageRefs, seen, limit, yielded));
      }

      if (sticky) {
        this.stickyStorageState = await session.exportStorageState();
      }
      return collected;
    } catch (error) {
      const detail =
        error instanceof BrowserSessionChallengeError
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
        detail: `searchads warm-up failed: ${detail}`,
      });
      return [];
    } finally {
      await session?.close();
    }
  }

  private async *discoverCityViaHtml(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): AsyncIterable<ExternalListingRef> {
    for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
      if (yielded.count >= limit) return;
      try {
        const { html } = await fetchListingViaLadder(runtime, searchUrl(city, page), {
          provider: this.id,
          isChallenge: isFotocasaChallenge,
          metrics: this.metrics,
          init: { signal },
        });
        const refs = parseFotocasaSearch(html);
        if (refs.length === 0) return;
        for (const ref of yieldRefs(refs, seen, limit, yielded)) {
          yield ref;
        }
      } catch (error) {
        if (error instanceof ChallengeError) return;
        throw error;
      }
    }
  }

  /**
   * AJAX-first detail fetch: warm session → property JSON API → warmed HTML.
   * Ladder HTML is last resort when the session pool is absent or warm-up fails.
   */
  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (ctx.runtime.openBrowserSession) {
      const fromSession = await this.fetchDetailViaSession(ref, ctx);
      if (fromSession) return fromSession;
    }

    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isFotocasaChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    const payload = parseFotocasaDetail(html, ref.url);
    return { ref, payload };
  }

  private async fetchDetailViaSession(
    ref: ExternalListingRef,
    ctx: FetchContext,
  ): Promise<RawListing | undefined> {
    if (!ctx.runtime.openBrowserSession) return undefined;

    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }

    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await ctx.runtime.openBrowserSession({
        warmUrl: ref.url,
        signal: ctx.signal,
        contentSelector: 'script[type="application/ld+json"], main, h1',
        isChallenge: isFotocasaChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });

      const transactionType = ref.url.includes('/comprar') || ref.url.includes('/venta') ? 'BUY' : 'RENT';
      const propertyUrl = fotocasaPropertyApiUrl(ref.sourceId, transactionType);
      const propertyRes = await session.request(propertyUrl, {
        referer: session.pageUrl(),
        timeoutMs: 30_000,
      });

      if (
        propertyRes.status < 400 &&
        !isFotocasaPropertyChallenge(propertyRes.body)
      ) {
        try {
          const payload = parseFotocasaPropertyJson(propertyRes.body, ref.url);
          this.metrics.record({
            provider: this.id,
            strategy: 'browser',
            outcome: 'success',
            status: propertyRes.status,
            latencyMs: Date.now() - start,
            url: propertyUrl,
            detail: 'property-json',
          });
          if (sticky) {
            this.stickyStorageState = await session.exportStorageState();
          }
          return { ref, payload };
        } catch {
          // Fall through to warmed HTML when JSON shape is unexpected.
        }
      } else if (
        propertyRes.status === 403 ||
        propertyRes.status === 429 ||
        isFotocasaPropertyChallenge(propertyRes.body)
      ) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          status: propertyRes.status,
          latencyMs: Date.now() - start,
          url: propertyUrl,
          detail: 'property API PerimeterX challenge after warm-up',
        });
      }

      const html = await session.content();
      if (isFotocasaChallenge(html)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          status: 200,
          latencyMs: Date.now() - start,
          url: ref.url,
          detail: 'detail session still challenged',
        });
        return undefined;
      }

      const payload = parseFotocasaDetail(html, ref.url);
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url: ref.url,
        detail: 'detail-html',
      });

      if (sticky) {
        this.stickyStorageState = await session.exportStorageState();
      }
      return { ref, payload };
    } catch {
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'error',
        latencyMs: Date.now() - start,
        url: ref.url,
        detail: 'detail session warm-up failed; falling back to ladder',
      });
      return undefined;
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, listing } = asFotocasaRaw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`fotocasa: listing ${sourceId} has no resolvable price`);
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
    const furnished = resolveFurnished(listing.furnished);
    if (furnished !== 'not_specified') result.furnishedStatus = furnished;

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
      detail: `Serving ES via ${FOTOCASA_BASE_URL} (searchads+property JSON, HTML fallback)`,
    };
  }
}

export { fotocasaSourceIdFromUrl };
