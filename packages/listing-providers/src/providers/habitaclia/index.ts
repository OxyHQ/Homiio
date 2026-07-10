/**
 * Habitaclia provider (Spain).
 *
 * Discover prefers warmed Playwright session → POST `/dotnet/listados/listainmuebles`
 * (HTML fragments with `data-href` cards); fetch uses the shared ladder for detail
 * HTML (JSON-LD when present, microdata/meta fallback). Registered OFF by default.
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
import { BrowserSessionChallengeError, type BrowserSession, type BrowserStorageState } from '../../browserSession';
import { createProxySessionId, envBool } from '../../proxy';
import { HABITACLIA_BASE_URL, type HabitacliaRawListing } from './fixtures';
import { habitacliaSourceIdFromUrl, parseHabitacliaDetail, parseHabitacliaSearch } from './parse';
import {
  HABITACLIA_LISTAINMUEBLES_URL,
  HABITACLIA_LISTING_CARD_SELECTOR,
  buildHabitacliaListainmueblesBody,
  extractHabitacliaListadoFormFields,
  habitacliaWarmSearchUrl,
  isHabitacliaListainmueblesChallenge,
  parseHabitacliaListainmuebles,
} from './listainmuebles';

const PROVIDER_ID: ProviderId = 'habitaclia';

export function isHabitacliaChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /acceso denegado|verifica|datadome|px-captcha|Pardon Our Interruption|hab_library/i.test(
    html,
  );
}

const DEFAULT_CITIES: readonly string[] = ['barcelona', 'madrid', 'valencia', 'sevilla', 'malaga'];
const MAX_SEARCH_PAGES = 5;
const LISTAINMUEBLES_POST_TIMEOUT_MS = 45_000;
const SUPPORTED_TYPES: ReadonlySet<string> = new Set(Object.values(PropertyType));

function resolvePropertyType(raw: string): PropertyType {
  return SUPPORTED_TYPES.has(raw) ? (raw as PropertyType) : PropertyType.APARTMENT;
}

function resolveFurnished(furnished: boolean | undefined): NormalizedListing['furnishedStatus'] {
  if (furnished === true) return 'furnished';
  if (furnished === false) return 'unfurnished';
  return 'not_specified';
}

function asHabitaclia(payload: unknown): HabitacliaRawListing {
  const record = payload as { id?: unknown; url?: unknown } | null;
  if (!record || typeof record.id !== 'string' || typeof record.url !== 'string') {
    throw new Error('habitaclia provider received a payload that is not a HabitacliaRawListing');
  }
  return payload as HabitacliaRawListing;
}

function toRemoteImages(raw: HabitacliaRawListing): NormalizedRemoteImage[] {
  return raw.images.map((image, index) => ({
    url: image.url,
    caption: image.caption,
    isPrimary: image.isPrimary ?? index === 0,
  }));
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

export interface HabitacliaProviderOptions {
  runtime?: FetchRuntime;
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class HabitacliaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;

  private readonly runtime: FetchRuntime;
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: HabitacliaProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : DEFAULT_CITIES;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    const yielded = { count: 0 };
    const runtime = job.runtime ?? this.runtime;

    const beforeSession = yielded.count;
    if (runtime.openBrowserSession) {
      for await (const ref of this.discoverViaListainmueblesSession(
        runtime,
        cities,
        job.signal,
        seen,
        limit,
        yielded,
      )) {
        yield ref;
      }
      if (yielded.count >= limit) return;
    }

    if (yielded.count > beforeSession) return;

    for (const city of cities) {
      if (yielded.count >= limit) return;
      for await (const ref of this.discoverCityViaHtml(runtime, city, job.signal, seen, limit, yielded)) {
        yield ref;
      }
    }
  }

  private habitacliaSessionOptions(city: string, sticky: boolean) {
    return {
      warmUrl: habitacliaWarmSearchUrl(city, 1),
      contentSelector: HABITACLIA_LISTING_CARD_SELECTOR,
      isChallenge: isHabitacliaChallenge,
      stickyProxySession: sticky,
      proxySessionId: this.stickyProxySessionId,
      storageState: this.stickyStorageState,
      blockAssets: true,
      reloadAfterPolls: 4,
      postChallengeSettleMs: 1_500,
    } as const;
  }

  /**
   * One warmed Playwright session serves every city: warm page 1, POST
   * listainmuebles for pages 2+, then `warmNavigate` to the next city.
   */
  private async *discoverViaListainmueblesSession(
    runtime: FetchRuntime,
    cities: readonly string[],
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
      const firstCity = cities[0];
      if (!firstCity) return;

      session = await runtime.openBrowserSession({
        ...this.habitacliaSessionOptions(firstCity, sticky),
        signal,
      });

      for (const city of cities) {
        if (yielded.count >= limit) return;

        if (city !== firstCity) {
          await session.warmNavigate({
            ...this.habitacliaSessionOptions(city, sticky),
            signal,
          });
        }

        const searchHtml = await session.content();
        const formFields = extractHabitacliaListadoFormFields(searchHtml);
        if (Object.keys(formFields).length === 0) continue;

        for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
          if (yielded.count >= limit) return;

          let body: string;
          let status: number;
          if (page === 1 && parseHabitacliaSearch(searchHtml).length > 0) {
            body = searchHtml;
            status = 200;
          } else {
            const response = await session.request(HABITACLIA_LISTAINMUEBLES_URL, {
              method: 'POST',
              data: buildHabitacliaListainmueblesBody(formFields, page),
              referer: session.pageUrl(),
              timeoutMs: LISTAINMUEBLES_POST_TIMEOUT_MS,
              headers: {
                Accept: 'text/html, */*',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              },
            });
            body = response.body;
            status = response.status;
          }

          if (status === 403 || status === 429 || isHabitacliaListainmueblesChallenge(body)) {
            this.metrics.record({
              provider: this.id,
              strategy: 'browser',
              outcome: 'challenge',
              status,
              latencyMs: Date.now() - start,
              url: HABITACLIA_LISTAINMUEBLES_URL,
              detail: `listainmuebles challenge on ${city} page ${page}`,
            });
            break;
          }
          if (status >= 400) break;

          const pageRefs = parseHabitacliaListainmuebles(body);
          this.metrics.record({
            provider: this.id,
            strategy: 'browser',
            outcome: 'success',
            status,
            latencyMs: Date.now() - start,
            url: HABITACLIA_LISTAINMUEBLES_URL,
          });
          if (pageRefs.length === 0) break;
          for (const ref of yieldRefs(pageRefs, seen, limit, yielded)) {
            yield ref;
          }
        }
      }

      if (sticky) {
        this.stickyStorageState = await session.exportStorageState();
      }
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
        url: habitacliaWarmSearchUrl(cities[0] ?? 'madrid', 1),
        detail: `listainmuebles session failed: ${detail}`,
      });
    } finally {
      await session?.close();
    }
  }

  private async discoverCityViaHttpAjax(
    runtime: FetchRuntime,
    city: string,
    firstPageHtml: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): Promise<ExternalListingRef[]> {
    const formFields = extractHabitacliaListadoFormFields(firstPageHtml);
    if (Object.keys(formFields).length === 0) return [];

    const collected: ExternalListingRef[] = [];
    const referer = habitacliaWarmSearchUrl(city, 1);
    for (let page = 2; page <= MAX_SEARCH_PAGES; page += 1) {
      if (yielded.count >= limit) break;
      const { status, body } = await runtime.fetchHttp(HABITACLIA_LISTAINMUEBLES_URL, {
        signal,
        method: 'POST',
        body: buildHabitacliaListainmueblesBody(formFields, page),
        headers: {
          Accept: 'text/html, */*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Referer: referer,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (status >= 400 || isHabitacliaListainmueblesChallenge(body)) break;
      const pageRefs = parseHabitacliaListainmuebles(body);
      if (pageRefs.length === 0) break;
      collected.push(...yieldRefs(pageRefs, seen, limit, yielded));
    }
    return collected;
  }

  private async *discoverCityViaHtml(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): AsyncIterable<ExternalListingRef> {
    let firstPageHtml = '';
    for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
      if (yielded.count >= limit) return;
      if (page > 1 && !runtime.fetchViaBrowser) break;
      const { html } = await fetchListingViaLadder(runtime, habitacliaWarmSearchUrl(city, page), {
        provider: this.id,
        isChallenge: isHabitacliaChallenge,
        metrics: this.metrics,
        init: { signal },
        tiers: page === 1 ? undefined : ['browser'],
      });
      if (page === 1) firstPageHtml = html;
      const refs = parseHabitacliaSearch(html);
      if (refs.length === 0) break;
      for (const ref of yieldRefs(refs, seen, limit, yielded)) {
        yield ref;
      }
    }

    if (firstPageHtml.length > 0) {
      for (const ref of await this.discoverCityViaHttpAjax(
        runtime,
        city,
        firstPageHtml,
        signal,
        seen,
        limit,
        yielded,
      )) {
        yield ref;
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isHabitacliaChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    return { ref, payload: parseHabitacliaDetail(html, ref.url) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asHabitaclia(raw.payload);
    const offerings =
      listing.operation === 'sale' ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT];

    return {
      source: this.id,
      sourceId: listing.id,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.region,
        country: listing.address.country,
        countryCode: listing.address.countryCode ?? 'ES',
        postalCode: listing.address.postalCode,
        neighborhood: listing.address.neighborhood,
        coordinates:
          listing.address.lat !== undefined && listing.address.lng !== undefined
            ? { lat: listing.address.lat, lng: listing.address.lng }
            : undefined,
      },
      type: resolvePropertyType(listing.propertyType),
      offerings,
      longTermRent:
        listing.operation === 'sale'
          ? undefined
          : { monthlyAmount: listing.price, currency: listing.currency },
      sale:
        listing.operation === 'sale'
          ? { price: listing.price, currency: listing.currency }
          : undefined,
      description: listing.description,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      squareFootage: listing.squareMeters,
      floor: listing.floor,
      amenities: listing.amenities,
      furnishedStatus: resolveFurnished(listing.furnished),
      remoteImages: toRemoteImages(listing),
      status: 'published',
    };
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
      detail: `Serving ${this.markets.join(', ')} via ${HABITACLIA_BASE_URL} (listainmuebles AJAX + HTML fallback)`,
    };
  }
}

export { habitacliaSourceIdFromUrl };
