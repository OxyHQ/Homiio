/**
 * Imobiliare.ro provider (Romania) — Inertia JSON search + JSON-LD detail.
 *
 * Discover parses `data-page` listing cards (JSON). Fetch prefers schema.org
 * `@graph` and optionally enriches contact via portal AJAX
 * (`/api/portal/listings/:id/whatsapp-url`, phone endpoints) from a warmed
 * Playwright session. Registered OFF by default (`PROVIDER_IMOBILIARE_RO_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../../browserSession';
import { BrowserSessionChallengeError } from '../../../browserSession';
import { createProxySessionId, envBool } from '../../../proxy';
import { citySlug } from '../../../slug';
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
import { ChallengeError, fetchListingViaLadder } from '../../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { IMOBILIARE_RO_BASE_URL } from './fixtures';
import {
  isImobiliareRoChallenge,
  mergeImobiliareRoContact,
  parseImobiliareRoDetail,
  parseImobiliareRoSearch,
  type ImobiliareRoRawListing,
  type ImobiliareRoSearchRef,
} from './parse';

const PROVIDER_ID: ProviderId = 'imobiliare_ro';

const DEFAULT_CITIES: readonly string[] = [
  'bucuresti',
  'cluj-napoca',
  'timisoara',
  'iasi',
  'brasov',
];

const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR = '[data-page], script[type="application/ld+json"], main';

export interface ImobiliareRoProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function searchUrl(city: string, page: number, kind: 'inchirieri' | 'vanzare' = 'inchirieri'): string {
  const path =
    kind === 'inchirieri'
      ? `${IMOBILIARE_RO_BASE_URL}/inchirieri-apartamente/${citySlug(city)}`
      : `${IMOBILIARE_RO_BASE_URL}/vanzare-apartamente/${citySlug(city)}`;
  return page <= 1 ? path : `${path}?page=${page}`;
}

function asRaw(payload: unknown): ImobiliareRoRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; price?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('imobiliare_ro: normalize received an invalid payload');
  }
  return payload as ImobiliareRoRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function yieldRefs(
  refs: readonly ImobiliareRoSearchRef[],
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
      hints: ref.hints,
    });
    yielded.count += 1;
  }
  return out;
}

export class ImobiliareRoProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['RO'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: ImobiliareRoProviderOptions = {}) {
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
      const viaSession = runtime.openBrowserSession
        ? await this.discoverViaSession(runtime, city, job.signal, seen, limit, yielded)
        : [];
      for (const ref of viaSession) yield ref;
      if (yielded.count >= limit) return;

      if (viaSession.length === 0) {
        for await (const ref of this.discoverViaLadder(runtime, city, job.signal, seen, limit, yielded)) {
          yield ref;
        }
      }
    }
  }

  private async discoverViaSession(
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
    const start = Date.now();
    const warmUrl = searchUrl(city, 1);
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isImobiliareRoChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'ro-RO',
        acceptLanguage: 'ro-RO,ro;q=0.9,en;q=0.8',
      });

      const collected: ExternalListingRef[] = [];
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded.count >= limit) break;
        const pageUrl = searchUrl(city, page);
        const { status, body } =
          page === 1
            ? { status: 200, body: await session.content() }
            : await session.request(pageUrl, {
                referer: session.pageUrl(),
                headers: { Accept: 'text/html,application/xhtml+xml' },
              });
        if (status >= 400 || isImobiliareRoChallenge(body)) break;
        const refs = parseImobiliareRoSearch(body);
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'success',
          status,
          latencyMs: Date.now() - start,
          url: pageUrl,
        });
        if (refs.length === 0) break;
        collected.push(...yieldRefs(refs, seen, limit, yielded));
      }
      if (sticky) this.stickyStorageState = await session.exportStorageState();
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
        detail,
      });
      return [];
    } finally {
      await session?.close();
    }
  }

  private async *discoverViaLadder(
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
          isChallenge: isImobiliareRoChallenge,
          metrics: this.metrics,
          init: { signal },
        });
        const refs = parseImobiliareRoSearch(html);
        if (refs.length === 0) return;
        for (const ref of yieldRefs(refs, seen, limit, yielded)) yield ref;
      } catch (error) {
        if (error instanceof ChallengeError) return;
        throw error;
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const hints = ref.hints as ImobiliareRoSearchRef['hints'] | undefined;

    if (ctx.runtime.openBrowserSession) {
      const fromSession = await this.fetchViaSession(ref, ctx, hints);
      if (fromSession) return fromSession;
    }

    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isImobiliareRoChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    const payload = parseImobiliareRoDetail(html, ref.url, hints);
    return { ref, payload };
  }

  private async fetchViaSession(
    ref: ExternalListingRef,
    ctx: FetchContext,
    hints: ImobiliareRoSearchRef['hints'] | undefined,
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
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isImobiliareRoChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'ro-RO',
        acceptLanguage: 'ro-RO,ro;q=0.9,en;q=0.8',
      });

      const html = await session.content();
      if (isImobiliareRoChallenge(html)) return undefined;
      let payload = parseImobiliareRoDetail(html, ref.url, hints);

      // Best-effort contact AJAX (may 404 when portal gates phones).
      const contactPaths = [
        `${IMOBILIARE_RO_BASE_URL}/api/portal/listings/${ref.sourceId}/whatsapp-url`,
        `${IMOBILIARE_RO_BASE_URL}/api/portal/listings/${ref.sourceId}/phone`,
        hints?.phoneApiUrl,
      ].filter((path): path is string => Boolean(path));

      for (const contactUrl of contactPaths) {
        try {
          const { status, body } = await session.request(contactUrl, {
            referer: ref.url,
            timeoutMs: 15_000,
          });
          if (status >= 200 && status < 300 && body.trim().length > 2) {
            payload = mergeImobiliareRoContact(payload, body);
          }
        } catch {
          // Contact enrichment is optional.
        }
      }

      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url: ref.url,
      });
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return { ref, payload };
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    const isSale = listing.operation === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.region,
        country: 'Romania',
        countryCode: listing.address.countryCode,
        neighborhood: listing.address.neighborhood,
      },
      type: PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };
    if (listing.description) result.description = listing.description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.floor !== undefined) result.floor = listing.floor;
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving RO via ${IMOBILIARE_RO_BASE_URL} (Inertia JSON + JSON-LD)`,
    };
  }
}

export {
  isImobiliareRoChallenge,
  parseImobiliareRoDetail,
  parseImobiliareRoSearch,
  imobiliareRoSourceIdFromUrl,
} from './parse';
