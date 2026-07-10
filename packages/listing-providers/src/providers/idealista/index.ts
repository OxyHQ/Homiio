/**
 * Idealista provider (Spain) — reference AJAX-with-Playwright-session pattern.
 *
 * Acquisition order (JSON/AJAX first, HTML last):
 *   Discover: warm session → georeach AJAX → HTML search ladder fallback.
 *   Fetch: warm detail session → contact AJAX (phones / adContactInfo) →
 *   detail HTML JSON-LD from the warmed page → ladder HTML fallback.
 *
 * Datalayer alone is analytics-only and never the sole ingest source.
 * Contact is best-effort: DataDome may still block after warm-up.
 *
 * Official partner API remains gated (`hasOfficialApi`). Registered OFF by
 * default (`PROVIDER_IDEALISTA_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedListingContact,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type {
  BrowserSession,
  BrowserStorageState,
} from '../../session';
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
import { providerMaxSearchPages } from '../../discoverLimits';
import { isDataDomeHtmlChallenge } from '../../parse/challenge';
import type { EsSchemaListing } from '../../parse/jsonLd';
import { IDEALISTA_BASE_URL } from './fixtures';
import {
  idealistaContactInfoUrl,
  idealistaContactPhonesUrl,
  isIdealistaContactChallenge,
  mergeIdealistaContact,
  parseIdealistaContactInfo,
  parseIdealistaContactPhones,
  type IdealistaContact,
} from './contact';
import {
  idealistaGeoreachUrl,
  idealistaWarmHomeUrl,
  idealistaWarmSearchUrl,
  isIdealistaGeoreachChallenge,
  parseIdealistaGeoreach,
} from './georeach';
import { idealistaSourceIdFromUrl, parseIdealistaDetail, parseIdealistaSearch, type IdealistaRaw } from './parse';

const ES_PROXY_COUNTRY = 'es';
const PROVIDER_ID: ProviderId = 'idealista';

/** ES cities enumerated when a discover job carries no explicit `city`. */
const DEFAULT_CITIES: readonly string[] = [
  'madrid',
  'barcelona',
  'valencia',
  'sevilla',
  'malaga',
  'bilbao',
  'zaragoza',
  'alicante',
  'murcia',
  'palma',
];

const DEFAULT_MAX_SEARCH_PAGES = 50;

/** Idealista content markers after warm-up (search results, filters, or main shell). */
const IDEALISTA_CONTENT_SELECTOR =
  'article.item, .items-list, section.items-container, #listingFilter, .list-notices, main#main-content, #main-content';

/** Headers for georeach/contact AJAX from a warmed ES session. */
const IDEALISTA_AJAX_HEADERS: Readonly<Record<string, string>> = {
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
};

/** True when warmed HTML still carries listing/search markup (not a bot wall). */
function idealistaPageHasContent(html: string): boolean {
  return /article\.item|items-container|inmueble\/\d{5,}|application\/ld\+json|listingFilter/i.test(html);
}

/** HTML markers of an Idealista interstitial/anti-bot page served with a 200. */
export function isIdealistaChallenge(html: string): boolean {
  return isDataDomeHtmlChallenge(html, idealistaPageHasContent(html));
}

/** Options for {@link IdealistaProvider}. */
export interface IdealistaProviderOptions {
  /** Runtime used by `discover()` (fetch uses the per-call context runtime). */
  runtime?: FetchRuntime;
  /** Override the default discover city list. */
  cities?: readonly string[];
  /** Metrics sink + reader; defaults to the process-wide store. */
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

/** Build an Idealista rental search URL for a city + 1-based page number. */
function searchUrl(city: string, page: number): string {
  return idealistaWarmSearchUrl(city, page);
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

function asIdealistaRaw(payload: unknown): IdealistaRaw {
  const record = payload as IdealistaRaw | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.listing !== 'object'
  ) {
    throw new Error('idealista: normalize received a payload that is not an IdealistaRaw');
  }
  return record;
}

function toNormalizedContact(contact: IdealistaContact | undefined): NormalizedListingContact | undefined {
  if (!contact) return undefined;
  const mapped: NormalizedListingContact = {};
  if (contact.phone) mapped.phone = contact.phone;
  if (contact.email) mapped.email = contact.email;
  if (contact.whatsapp) mapped.whatsapp = contact.whatsapp;
  if (contact.name) mapped.name = contact.name;
  if (contact.agencyName) mapped.agencyName = contact.agencyName;
  return mapped.phone || mapped.email || mapped.whatsapp || mapped.name || mapped.agencyName
    ? mapped
    : undefined;
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

export class IdealistaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;
  /** Idealista offers an official partner API; gated (no creds) in this phase. */
  readonly hasOfficialApi = true;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private readonly maxSearchPages: number;

  /** Sticky proxy session id + storage reused across cities when sticky is on. */
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: IdealistaProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
    this.metrics = options.metrics ?? defaultProviderMetrics;
    this.maxSearchPages = providerMaxSearchPages(PROVIDER_ID, DEFAULT_MAX_SEARCH_PAGES, 'ES');
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    const yielded = { count: 0 };
    const runtime = job.runtime ?? this.runtime;

    for (const city of cities) {
      if (yielded.count >= limit) return;

      const viaHttp = await this.discoverCityViaHttp(runtime, city, job.signal, seen, limit, yielded);
      for (const ref of viaHttp) yield ref;
      if (yielded.count >= limit) return;

      const viaAjax = runtime.openBrowserSession
        ? await this.discoverCityViaGeoreach(runtime, city, job.signal, seen, limit, yielded)
        : [];
      for (const ref of viaAjax) yield ref;
      if (yielded.count >= limit) return;

      // HTML fallback when georeach yielded nothing (no session, challenge, empty).
      if (viaAjax.length === 0) {
        for await (const ref of this.discoverCityViaHtml(runtime, city, job.signal, seen, limit, yielded)) {
          yield ref;
        }
      }
    }
  }

  /**
   * Proxied HTTP search page (page 1) before Playwright warm-up. Returns refs
   * yielded (empty when blocked — caller continues to georeach session).
   */
  private async discoverCityViaHttp(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): Promise<ExternalListingRef[]> {
    const start = Date.now();
    const url = idealistaWarmSearchUrl(city, 1);
    try {
      const { status, body } = await runtime.fetchHttp(url, {
        signal,
        proxyCountry: ES_PROXY_COUNTRY,
        headers: {
          ...IDEALISTA_AJAX_HEADERS,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (status >= 400 || isIdealistaChallenge(body)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'http',
          outcome: status === 403 || status === 429 ? 'challenge' : 'error',
          status,
          latencyMs: Date.now() - start,
          url,
          detail: 'search HTTP blocked before georeach',
        });
        return [];
      }
      const pageRefs = parseIdealistaSearch(body);
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'success',
        status,
        latencyMs: Date.now() - start,
        url,
        detail: pageRefs.length > 0 ? 'search-http' : 'search-http-empty',
      });
      return yieldRefs(pageRefs, seen, limit, yielded);
    } catch (error) {
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'error',
        latencyMs: Date.now() - start,
        url,
        detail: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Warm session on city search → georeach AJAX pages. Returns refs yielded
   * (empty when warm-up/challenge fails — caller falls back to HTML).
   */
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
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }

    let session: BrowserSession | undefined;
    const searchUrl = idealistaWarmSearchUrl(city, 1);
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl: idealistaWarmHomeUrl(),
        signal,
        contentSelector: IDEALISTA_CONTENT_SELECTOR,
        isChallenge: isIdealistaChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'es-ES',
        acceptLanguage: 'es-ES,es;q=0.9,en;q=0.8',
        proxyCountry: ES_PROXY_COUNTRY,
      });

      await session.warmNavigate({
        warmUrl: searchUrl,
        signal,
        contentSelector: IDEALISTA_CONTENT_SELECTOR,
        isChallenge: isIdealistaChallenge,
        challengeWaitMs: 45_000,
      });

      const collected: ExternalListingRef[] = [];
      for (let page = 1; page <= this.maxSearchPages; page += 1) {
        if (yielded.count >= limit) break;
        const ajaxUrl = idealistaGeoreachUrl(city, page);
        const { status, body } = await session.request(ajaxUrl, {
          referer: session.pageUrl(),
          timeoutMs: 30_000,
          headers: IDEALISTA_AJAX_HEADERS,
        });

        if (status === 403 || status === 429 || isIdealistaGeoreachChallenge(body)) {
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
        if (status >= 400) {
          this.metrics.record({
            provider: this.id,
            strategy: 'browser',
            outcome: 'error',
            status,
            latencyMs: Date.now() - start,
            url: ajaxUrl,
          });
          break;
        }

        const pageRefs = parseIdealistaGeoreach(body);
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
        url: idealistaWarmSearchUrl(city, 1),
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
    for (let page = 1; page <= this.maxSearchPages; page += 1) {
      if (yielded.count >= limit) return;
      try {
        const { html } = await fetchListingViaLadder(runtime, searchUrl(city, page), {
          provider: this.id,
          isChallenge: isIdealistaChallenge,
          metrics: this.metrics,
          init: { signal },
        });
        const refs = parseIdealistaSearch(html);
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
   * AJAX-first detail fetch: warm session → contact AJAX → JSON-LD from warmed
   * page HTML. Ladder HTML is last resort when the session pool is absent or
   * warm-up fails.
   */
  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (ctx.runtime.openBrowserSession) {
      const fromSession = await this.fetchDetailViaSession(ref, ctx);
      if (fromSession) return fromSession;
    }

    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isIdealistaChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    const payload = parseIdealistaDetail(html, ref.url);
    return { ref, payload };
  }

  /**
   * Best-effort contact AJAX from a warmed session. Never throws — challenge
   * or empty bodies yield undefined.
   */
  private async fetchContactViaSession(
    session: BrowserSession,
    adId: string,
  ): Promise<IdealistaContact | undefined> {
    const referer = session.pageUrl();
    let fromPhones: IdealistaContact | undefined;
    let fromInfo: IdealistaContact | undefined;

    try {
      const phonesUrl = idealistaContactPhonesUrl(adId);
      const phonesRes = await session.request(phonesUrl, {
        referer,
        timeoutMs: 20_000,
        headers: IDEALISTA_AJAX_HEADERS,
      });
      if (phonesRes.status < 400 && !isIdealistaContactChallenge(phonesRes.body)) {
        const phones = parseIdealistaContactPhones(phonesRes.body);
        if (phones[0]) fromPhones = { phone: phones[0] };
      }
    } catch {
      // Best-effort — contact is optional.
    }

    try {
      const infoUrl = idealistaContactInfoUrl(adId);
      const infoRes = await session.request(infoUrl, {
        referer,
        timeoutMs: 20_000,
        headers: IDEALISTA_AJAX_HEADERS,
      });
      if (infoRes.status < 400 && !isIdealistaContactChallenge(infoRes.body)) {
        fromInfo = parseIdealistaContactInfo(infoRes.body);
      }
    } catch {
      // Best-effort — contact is optional.
    }

    return mergeIdealistaContact(fromPhones, fromInfo);
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
        contentSelector: 'script[type="application/ld+json"], main, h1, article',
        isChallenge: isIdealistaChallenge,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'es-ES',
        acceptLanguage: 'es-ES,es;q=0.9,en;q=0.8',
        proxyCountry: ES_PROXY_COUNTRY,
      });

      // Contact AJAX first (JSON) while the DataDome session is warm.
      const contact = await this.fetchContactViaSession(session, ref.sourceId);

      // Listing body: warmed page HTML JSON-LD (no rich public detail AJAX).
      const html = await session.content();
      if (isIdealistaChallenge(html)) {
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

      const payload = parseIdealistaDetail(html, ref.url);
      if (contact) payload.contact = contact;

      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url: ref.url,
        detail: contact ? 'detail+contact' : 'detail-only',
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
    const { sourceId, url, listing, contact } = asIdealistaRaw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`idealista: listing ${sourceId} has no resolvable price`);
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
    const normalizedContact = toNormalizedContact(contact);
    if (normalizedContact) result.contact = normalizedContact;

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
      detail: `Serving ES via ${IDEALISTA_BASE_URL} (georeach+contact AJAX, HTML fallback; official API gated)`,
    };
  }
}

export { idealistaSourceIdFromUrl };
