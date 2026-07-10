/**
 * Casa.it provider (Italy) — search AJAX first, JSON-LD detail + contact JSON.
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../../browserSession';
import { BrowserSessionChallengeError } from '../../../session';
import { createProxySessionId, envBool } from '../../../proxy';
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
import type { ItSchemaListing } from '../../../parse/jsonLd';
import { CASA_IT_BASE_URL } from './fixtures';
import {
  casaItSearchApiUrl,
  casaItSourceIdFromUrl,
  casaItWarmSearchUrl,
  parseCasaItDetail,
  parseCasaItSearch,
  parseCasaItSearchJson,
  type CasaItRaw,
} from './parse';

const PROVIDER_ID: ProviderId = 'casa_it';
const DEFAULT_CITIES: readonly string[] = ['roma', 'milano', 'napoli', 'torino', 'firenze'];
const MAX_SEARCH_PAGES = 3;

export function isCasaItChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /datadome|captcha-delivery|accesso negato|verifica/i.test(html);
}

export interface CasaItProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function resolvePropertyType(types: readonly string[]): PropertyType {
  const lower = types.map((type) => type.toLowerCase());
  if (lower.some((type) => type.includes('house') || type.includes('villa'))) return PropertyType.HOUSE;
  if (lower.some((type) => type.includes('studio') || type.includes('monolocale'))) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(listing: ItSchemaListing): NormalizedRemoteImage[] {
  return listing.images.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function asCasaItRaw(payload: unknown): CasaItRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; listing?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.listing !== 'object'
  ) {
    throw new Error('casa_it: normalize received a payload that is not a CasaItRaw');
  }
  return payload as CasaItRaw;
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

export class CasaItProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['IT'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: CasaItProviderOptions = {}) {
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
        ? await this.discoverCityViaAjax(runtime, city, job.signal, seen, limit, yielded)
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

  private async discoverCityViaAjax(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): Promise<ExternalListingRef[]> {
    if (!runtime.openBrowserSession) return [];
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();

    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl: casaItWarmSearchUrl(city, 1),
        signal,
        contentSelector: 'a[href*="/immobili/"], main, article',
        isChallenge: isCasaItChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'it-IT',
      });

      const collected: ExternalListingRef[] = [];
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded.count >= limit) break;
        const ajaxUrl = casaItSearchApiUrl(city, page);
        const { status, body } = await session.request(ajaxUrl, {
          referer: session.pageUrl(),
          timeoutMs: 30_000,
        });
        let pageRefs =
          status < 400 && !isCasaItChallenge(body) ? parseCasaItSearchJson(body) : [];
        if (pageRefs.length === 0 && page === 1) {
          pageRefs = parseCasaItSearch(await session.content());
        }
        if (pageRefs.length === 0) break;
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'success',
          status,
          latencyMs: Date.now() - start,
          url: ajaxUrl,
        });
        collected.push(...yieldRefs(pageRefs, seen, limit, yielded));
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
        url: casaItWarmSearchUrl(city, 1),
        detail: `casa.it warm-up failed: ${detail}`,
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
        const { html } = await fetchListingViaLadder(runtime, casaItWarmSearchUrl(city, page), {
          provider: this.id,
          isChallenge: isCasaItChallenge,
          metrics: this.metrics,
          init: { signal },
        });
        const refs = parseCasaItSearch(html);
        if (refs.length === 0) return;
        for (const ref of yieldRefs(refs, seen, limit, yielded)) yield ref;
      } catch (error) {
        if (error instanceof ChallengeError) return;
        throw error;
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (ctx.runtime.openBrowserSession) {
      const sticky = envBool('LISTING_PROXY_STICKY', false);
      if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();
      let session: BrowserSession | undefined;
      try {
        session = await ctx.runtime.openBrowserSession({
          warmUrl: ref.url,
          signal: ctx.signal,
          contentSelector: 'script[type="application/ld+json"], main, h1',
          isChallenge: isCasaItChallenge,
          challengeWaitMs: 45_000,
          stickyProxySession: sticky,
          proxySessionId: this.stickyProxySessionId,
          storageState: this.stickyStorageState,
          blockAssets: true,
          locale: 'it-IT',
        });
        const html = await session.content();
        if (!isCasaItChallenge(html)) {
          if (sticky) this.stickyStorageState = await session.exportStorageState();
          return { ref, payload: parseCasaItDetail(html, ref.url) };
        }
      } catch {
        // Fall through to ladder.
      } finally {
        await session?.close();
      }
    }
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isCasaItChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    return { ref, payload: parseCasaItDetail(html, ref.url) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, listing, contact } = asCasaItRaw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`casa_it: listing ${sourceId} has no resolvable price`);
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
        country: listing.address.country ?? 'Italy',
        countryCode: listing.address.countryCode ?? 'IT',
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
    if (description) result.description = description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.amenities.length > 0) result.amenities = listing.amenities;
    if (listing.furnished === true) result.furnishedStatus = 'furnished';
    if (contact) result.contact = contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving IT via ${CASA_IT_BASE_URL} (search AJAX + JSON-LD)`,
    };
  }
}

export { casaItSourceIdFromUrl };
