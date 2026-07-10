/**
 * Redfin provider (United States).
 *
 * Redfin's Stingray JSON endpoints are CloudFront-gated on cold HTTP. This
 * plugin warms a Playwright session on a city search page, then calls
 * `/stingray/api/gis` and `/stingray/api/home/details/initialInfo` via
 * `session.request` (shared browser-session pattern). Registered OFF by default
 * (`PROVIDER_REDFIN_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedListingAddress,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../../browserSession';
import { BrowserSessionChallengeError } from '../../../session';
import type {
  DiscoverJob,
  ExternalListingRef,
  FetchContext,
  FetchRuntime,
  ListingProvider,
  ProviderHealth,
  RawListing,
} from '../../../types';
import { createFetchRuntime } from '../../../runtime';
import { fetchListingViaLadder } from '../../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { envBool, createProxySessionId } from '../../../proxy';
import { cityToResourceSlug, DEFAULT_US_CITIES } from '../portals';
import { isUsPortalChallenge } from '../challenge';
import {
  REDFIN_CONTENT_SELECTOR,
  isRedfinStingrayChallenge,
  parseRedfinDetailResponse,
  parseRedfinGisResponse,
  redfinGisUrl,
  redfinInitialInfoUrl,
  redfinKindFromHome,
  redfinSourceUrl,
  redfinWarmUrl,
  type RedfinKind,
  type RedfinSearchRef,
} from './api';
import { REDFIN_BASE_URL, type RedfinHomeFixture } from './fixtures';

const PROVIDER_ID: ProviderId = 'redfin';
const CURRENCY = 'USD';
const COUNTRY = 'United States';
const GIS_PAGE_SIZE = 50;
const MAX_GIS_PAGES = 2;

export interface RedfinRaw {
  sourceId: string;
  url: string;
  kind: RedfinKind;
  home: RedfinHomeFixture;
}

export interface RedfinProviderOptions {
  runtime?: FetchRuntime;
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
  cities?: readonly string[];
}

function regionIdFromWarmUrl(warmUrl: string): number | undefined {
  const match = warmUrl.match(/\/city\/(\d+)\//);
  if (!match?.[1]) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function refKind(ref: ExternalListingRef): RedfinKind {
  return ref.hints?.kind === 'sale' ? 'sale' : 'rent';
}

function resolvePropertyType(kind: RedfinKind): PropertyType {
  return kind === 'sale' ? PropertyType.HOUSE : PropertyType.APARTMENT;
}

function toRemoteImages(home: RedfinHomeFixture): NormalizedRemoteImage[] {
  return home.photoUrls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function buildAddress(home: RedfinHomeFixture): NormalizedListingAddress {
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

function asRedfinRaw(payload: unknown): RedfinRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; kind?: unknown; home?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale') ||
    typeof record.home !== 'object' ||
    record.home === null
  ) {
    throw new Error('redfin provider received a payload that is not a RedfinRaw');
  }
  return payload as RedfinRaw;
}

function yieldRefs(
  refs: RedfinSearchRef[],
  seen: Set<string>,
  limit: number,
  yielded: { count: number },
): ExternalListingRef[] {
  const out: ExternalListingRef[] = [];
  for (const ref of refs) {
    if (yielded.count >= limit) break;
    if (seen.has(ref.sourceId)) continue;
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

export class RedfinProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['US'] as const;

  private readonly runtime: FetchRuntime;
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private readonly cities: readonly string[];
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: RedfinProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.metrics = options.metrics ?? defaultProviderMetrics;
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_US_CITIES;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const runtime = job.runtime ?? this.runtime;
    const seen = new Set<string>();
    const yielded = { count: 0 };

    for (const city of cities) {
      if (yielded.count >= limit) return;
      const viaAjax = runtime.openBrowserSession
        ? await this.discoverCityViaStingray(runtime, city, job.signal, seen, limit, yielded)
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

  private async discoverCityViaStingray(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): Promise<ExternalListingRef[]> {
    if (!runtime.openBrowserSession) return [];

    const citySlug = cityToResourceSlug(city);
    const warmUrl = redfinWarmUrl(citySlug);
    const regionId = regionIdFromWarmUrl(warmUrl);
    if (regionId === undefined) return [];

    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }

    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: REDFIN_CONTENT_SELECTOR,
        isChallenge: isUsPortalChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });

      const collected: ExternalListingRef[] = [];
      for (let page = 1; page <= MAX_GIS_PAGES; page += 1) {
        if (yielded.count >= limit) break;
        const ajaxUrl = redfinGisUrl(regionId, page, GIS_PAGE_SIZE);
        const { status, body } = await session.request(ajaxUrl, {
          referer: session.pageUrl(),
          timeoutMs: 30_000,
        });

        if (status === 403 || status === 429 || isRedfinStingrayChallenge(body)) {
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
        if (status >= 400) break;

        const pageRefs = parseRedfinGisResponse(body);
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: pageRefs.length > 0 ? 'success' : 'error',
          status,
          latencyMs: Date.now() - start,
          url: ajaxUrl,
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
        detail: `Stingray warm-up failed: ${detail}`,
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
    const warmUrl = redfinWarmUrl(cityToResourceSlug(city));
    const { html } = await fetchListingViaLadder(runtime, warmUrl, {
      provider: this.id,
      isChallenge: isUsPortalChallenge,
      metrics: this.metrics,
      init: { signal },
      tiers: ['browser', 'managed'],
    });
    const homePathRe = /href="(\/[^"]+\/home\/\d+)"/gi;
    const refs: RedfinSearchRef[] = [];
    for (const match of html.matchAll(homePathRe)) {
      const homePath = match[1];
      if (!homePath) continue;
      const propertyMatch = homePath.match(/\/home\/(\d+)/);
      const propertyId = propertyMatch?.[1];
      if (!propertyId) continue;
      refs.push({
        sourceId: propertyId,
        url: redfinSourceUrl(homePath),
        kind: 'sale',
        homePath,
      });
    }
    for (const ref of yieldRefs(refs, seen, limit, yielded)) {
      yield ref;
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const homePath = typeof ref.hints?.homePath === 'string' ? ref.hints.homePath : undefined;
    if (homePath && ctx.runtime.openBrowserSession) {
      const fromSession = await this.fetchViaStingray(ref, ctx, homePath);
      if (fromSession) return fromSession;
    }

    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isUsPortalChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
      tiers: ['browser', 'managed'],
    });
    const detail = parseRedfinDetailResponse(html);
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
      } satisfies RedfinRaw,
    };
  }

  private async fetchViaStingray(
    ref: ExternalListingRef,
    ctx: FetchContext,
    homePath: string,
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
        contentSelector: REDFIN_CONTENT_SELECTOR,
        isChallenge: isUsPortalChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });

      const ajaxUrl = redfinInitialInfoUrl(homePath);
      const { status, body } = await session.request(ajaxUrl, {
        referer: session.pageUrl(),
        timeoutMs: 30_000,
      });
      if (status >= 400 || isRedfinStingrayChallenge(body)) return undefined;

      const home = parseRedfinDetailResponse(body);
      if (!home) return undefined;

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
        payload: { sourceId: ref.sourceId, url: ref.url, kind, home } satisfies RedfinRaw,
      };
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, kind, home } = asRedfinRaw(raw.payload);

    const result: NormalizedListing = {
      source: this.id,
      sourceId,
      sourceUrl: url,
      address: buildAddress(home),
      type: resolvePropertyType(kind),
      offerings: kind === 'sale' ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      remoteImages: toRemoteImages(home),
      status: 'published',
      bedrooms: home.beds,
      bathrooms: home.baths,
      squareFootage: home.sqFt,
    };

    if (kind === 'sale') {
      result.sale = { price: home.price, currency: CURRENCY };
    } else {
      result.longTermRent = { monthlyAmount: home.price, currency: CURRENCY };
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
      detail: `Serving ${this.markets.join(', ')} via ${REDFIN_BASE_URL} Stingray (browser session)`,
    };
  }
}

export { parseRedfinGisResponse, parseRedfinDetailResponse, redfinKindFromHome };
