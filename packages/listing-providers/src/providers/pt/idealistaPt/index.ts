/**
 * Idealista.pt provider (Portugal) — AJAX-with-Playwright-session pattern.
 *
 * Separate from ES `idealista` (different host, `/imovel/`, Portuguese paths).
 * Reuses Iberian JSON-LD helpers ({@link extractEsSchemaListings}).
 *
 * Discover: warm session → georeach AJAX → HTML search fallback.
 * Fetch: detail HTML JSON-LD + optional contact AJAX (phones / agency).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedListingContact,
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
import type { EsSchemaListing } from '../../../parse/jsonLd';
import { IDEALISTA_PT_BASE_URL } from './fixtures';
import {
  idealistaPtContactInfoUrl,
  idealistaPtContactPhonesUrl,
  mergeIdealistaPtContact,
  parseIdealistaPtContactInfo,
  parseIdealistaPtContactPhones,
} from './contact';
import {
  idealistaPtGeoreachUrl,
  idealistaPtWarmSearchUrl,
  isIdealistaPtGeoreachChallenge,
  parseIdealistaPtGeoreach,
} from './georeach';
import {
  idealistaPtSourceIdFromUrl,
  parseIdealistaPtDetail,
  parseIdealistaPtSearch,
  type IdealistaPtRaw,
} from './parse';

const PROVIDER_ID: ProviderId = 'idealista_pt';
const DEFAULT_CITIES: readonly string[] = ['lisboa', 'porto', 'braga', 'coimbra', 'faro'];
const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR =
  'article.item, .items-list, section.items-container, main#main-content, #main-content';

export function isIdealistaPtChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /acesso negado|verifica que és humano|datadome|captcha-delivery/i.test(html);
}

export interface IdealistaPtProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function resolvePropertyType(types: readonly string[]): PropertyType {
  const lower = types.map((type) => type.toLowerCase());
  if (lower.some((type) => type.includes('house') || type.includes('moradia') || type.includes('villa'))) {
    return PropertyType.HOUSE;
  }
  if (lower.some((type) => type.includes('studio') || type.includes('estudio'))) return PropertyType.STUDIO;
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

function asIdealistaPtRaw(payload: unknown): IdealistaPtRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; listing?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.listing !== 'object'
  ) {
    throw new Error('idealista_pt: normalize received a payload that is not an IdealistaPtRaw');
  }
  return payload as IdealistaPtRaw;
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

async function fetchContactViaSession(
  session: BrowserSession,
  sourceId: string,
): Promise<NormalizedListingContact | undefined> {
  const phonesBody = await session.request(idealistaPtContactPhonesUrl(sourceId), {
    referer: session.pageUrl(),
    timeoutMs: 15_000,
  });
  const phones = phonesBody.status < 400 ? parseIdealistaPtContactPhones(phonesBody.body) : [];
  const infoBody = await session.request(idealistaPtContactInfoUrl(sourceId), {
    referer: session.pageUrl(),
    timeoutMs: 15_000,
  });
  const info = infoBody.status < 400 ? parseIdealistaPtContactInfo(infoBody.body) : undefined;
  return mergeIdealistaPtContact(info, phones[0] ? { phone: phones[0] } : undefined);
}

export class IdealistaPtProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['PT'] as const;
  readonly hasOfficialApi = true;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: IdealistaPtProviderOptions = {}) {
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
        ? await this.discoverCityViaGeoreach(runtime, city, job.signal, seen, limit, yielded)
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

  private async discoverCityViaGeoreach(
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
        warmUrl: idealistaPtWarmSearchUrl(city, 1),
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isIdealistaPtChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'pt-PT',
      });

      const collected: ExternalListingRef[] = [];
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded.count >= limit) break;
        const ajaxUrl = idealistaPtGeoreachUrl(city, page);
        const { status, body } = await session.request(ajaxUrl, {
          referer: session.pageUrl(),
          timeoutMs: 30_000,
        });
        if (status === 403 || status === 429 || isIdealistaPtGeoreachChallenge(body)) {
          this.metrics.record({
            provider: this.id,
            strategy: 'browser',
            outcome: 'challenge',
            status,
            latencyMs: Date.now() - start,
            url: ajaxUrl,
            detail: 'georeach DataDome challenge after warm-up',
          });
          break;
        }
        if (status >= 400) break;
        const pageRefs = parseIdealistaPtGeoreach(body);
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'success',
          status,
          latencyMs: Date.now() - start,
          url: ajaxUrl,
        });
        if (pageRefs.length === 0) break;
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
        url: idealistaPtWarmSearchUrl(city, 1),
        detail: `georeach warm-up failed: ${detail}`,
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
        const { html } = await fetchListingViaLadder(runtime, idealistaPtWarmSearchUrl(city, page), {
          provider: this.id,
          isChallenge: isIdealistaPtChallenge,
          metrics: this.metrics,
          init: { signal },
        });
        const refs = parseIdealistaPtSearch(html);
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
      const fromSession = await this.fetchDetailViaSession(ref, ctx);
      if (fromSession) return fromSession;
    }
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isIdealistaPtChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    return { ref, payload: parseIdealistaPtDetail(html, ref.url) };
  }

  private async fetchDetailViaSession(
    ref: ExternalListingRef,
    ctx: FetchContext,
  ): Promise<RawListing | undefined> {
    if (!ctx.runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();

    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await ctx.runtime.openBrowserSession({
        warmUrl: ref.url,
        signal: ctx.signal,
        contentSelector: 'script[type="application/ld+json"], main, h1',
        isChallenge: isIdealistaPtChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'pt-PT',
      });

      const html = await session.content();
      if (isIdealistaPtChallenge(html)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          latencyMs: Date.now() - start,
          url: ref.url,
          detail: 'detail session still challenged',
        });
        return undefined;
      }

      const payload = parseIdealistaPtDetail(html, ref.url);
      const contact = await fetchContactViaSession(session, payload.sourceId);
      if (contact) payload.contact = contact;

      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        latencyMs: Date.now() - start,
        url: ref.url,
      });
      if (sticky) this.stickyStorageState = await session.exportStorageState();
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
    const { sourceId, url, listing, contact } = asIdealistaPtRaw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`idealista_pt: listing ${sourceId} has no resolvable price`);
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
        country: listing.address.country ?? 'Portugal',
        countryCode: listing.address.countryCode ?? 'PT',
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
    if (contact) result.contact = contact;

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
      detail: `Serving PT via ${IDEALISTA_PT_BASE_URL} (georeach AJAX + contact AJAX + HTML fallback)`,
    };
  }
}

export { idealistaPtSourceIdFromUrl };
