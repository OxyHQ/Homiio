/**
 * Redfin provider (United States) — Stingray JSON via browser session.
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
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { envBool } from '../../../proxy';
import { cityToResourceSlug, DEFAULT_US_CITIES } from '../portals';
import { isUsPortalChallenge } from '../challenge';
import {
  isRedfinStingrayChallenge,
  parseRedfinDetailResponse,
  parseRedfinGisResponse,
  redfinGisUrl,
  redfinInitialInfoUrl,
  redfinSourceUrl,
  redfinWarmUrl,
  REDFIN_CONTENT_SELECTOR,
  type RedfinKind,
} from './api';
import { REDFIN_BASE_URL, type RedfinHomeFixture } from './fixtures';

const PROVIDER_ID: ProviderId = 'redfin';
const CURRENCY = 'USD';
const COUNTRY = 'United States';

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
    const runtime = job.runtime ?? this.runtime;
    if (!runtime.openBrowserSession) return;
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;

    for (const city of cities) {
      if (yielded >= limit) return;
      const citySlug = cityToResourceSlug(city);
      const warmUrl = redfinWarmUrl(citySlug);
      const regionId = regionIdFromWarmUrl(warmUrl);
      if (regionId === undefined) continue;

      let session: BrowserSession | undefined;
      try {
        session = await runtime.openBrowserSession({
          warmUrl,
          signal: job.signal,
          contentSelector: REDFIN_CONTENT_SELECTOR,
          isChallenge: isUsPortalChallenge,
          challengeWaitMs: 45_000,
          stickyProxySession: envBool('LISTING_PROXY_STICKY', false),
          proxySessionId: this.stickyProxySessionId,
          storageState: this.stickyStorageState,
        });
        const { status, body } = await session.request(redfinGisUrl(regionId, 1, 50), {
          referer: session.pageUrl(),
        });
        if (status >= 400 || isRedfinStingrayChallenge(body)) continue;
        for (const ref of parseRedfinGisResponse(body)) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yield {
            provider: this.id,
            sourceId: ref.sourceId,
            url: ref.url,
            hints: { kind: ref.kind, homePath: ref.homePath },
          };
          yielded += 1;
        }
        this.stickyStorageState = await session.exportStorageState();
      } catch (error) {
        if (error instanceof BrowserSessionChallengeError) continue;
        throw error;
      } finally {
        await session?.close();
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const homePath = typeof ref.hints?.homePath === 'string' ? ref.hints.homePath : undefined;
    if (homePath && ctx.runtime.openBrowserSession) {
      let session: BrowserSession | undefined;
      try {
        session = await ctx.runtime.openBrowserSession({
          warmUrl: ref.url,
          signal: ctx.signal,
          contentSelector: REDFIN_CONTENT_SELECTOR,
          isChallenge: isUsPortalChallenge,
        });
        const { status, body } = await session.request(redfinInitialInfoUrl(homePath), {
          referer: session.pageUrl(),
        });
        const home = !isRedfinStingrayChallenge(body) && status < 400 ? parseRedfinDetailResponse(body) : undefined;
        if (home) {
          return {
            ref,
            payload: { sourceId: ref.sourceId, url: ref.url, kind: refKind(ref), home } satisfies RedfinRaw,
          };
        }
      } finally {
        await session?.close();
      }
    }
    throw new Error(`redfin: could not fetch listing ${ref.sourceId} via Stingray session`);
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, kind, home } = asRedfinRaw(raw.payload);
    const result: NormalizedListing = {
      source: this.id,
      sourceId,
      sourceUrl: url,
      address: buildAddress(home),
      type: kind === 'sale' ? PropertyType.HOUSE : PropertyType.APARTMENT,
      offerings: kind === 'sale' ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      remoteImages: home.photoUrls.map((photoUrl, index) => ({ url: photoUrl, isPrimary: index === 0 })),
      status: 'published',
      bedrooms: home.beds,
      bathrooms: home.baths,
      squareFootage: home.sqFt,
    };
    if (kind === 'sale') result.sale = { price: home.price, currency: CURRENCY };
    else result.longTermRent = { monthlyAmount: home.price, currency: CURRENCY };
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving US via ${REDFIN_BASE_URL} Stingray (browser session)`,
    };
  }
}

export { parseRedfinGisResponse, parseRedfinDetailResponse };
