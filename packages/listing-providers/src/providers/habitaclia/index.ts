/**
 * Habitaclia provider (Spain) — HTTP-first.
 *
 * Discover paginates the server-rendered search over plain HTTP GET
 * (`/alquiler-<city>-<page>.htm`, `data-href` cards) through the residential
 * proxy — the canonical paginated URLs return every page cold, so no browser is
 * needed. A warmed Playwright session (`POST /dotnet/listados/listainmuebles`)
 * is the per-city FALLBACK, opened only for cities Imperva challenges over cold
 * HTTP. Fetch uses the shared ladder for detail HTML (JSON-LD when present,
 * microdata/meta fallback), which escalates to the browser tier when the
 * detail page is challenged. Registered OFF by default.
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
import { fetchListingViaLadder, classifyOutcome } from '../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../metrics';
import { providerMaxSearchPages } from '../../discoverLimits';
import { BrowserSessionChallengeError, type BrowserSession, type BrowserStorageState } from '../../browserSession';
import { createProxySessionId, envBool } from '../../proxy';
import { HABITACLIA_BASE_URL, type HabitacliaRawListing } from './fixtures';
import { habitacliaSourceIdFromUrl, parseHabitacliaDetail, parseHabitacliaSearch } from './parse';
import { parseHabitacliaSearchJson } from './searchJson';
import { asRecord } from '../../parse/guards';
import {
  HABITACLIA_LISTAINMUEBLES_URL,
  HABITACLIA_LISTING_CARD_SELECTOR,
  buildHabitacliaListainmueblesBody,
  extractHabitacliaListadoFormFields,
  habitacliaWarmHomeUrl,
  habitacliaWarmSearchUrl,
  isHabitacliaListainmueblesChallenge,
  parseHabitacliaListainmuebles,
} from './listainmuebles';
import { habitacliaCitiesFromEnv } from './cities';

const PROVIDER_ID: ProviderId = 'habitaclia';
const ES_PROXY_COUNTRY = 'es';

export function isHabitacliaChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /acceso denegado|verifica que eres|datadome|px-captcha|Pardon Our Interruption|Request unsuccessful\. Incapsula/i.test(
    html,
  );
}

const DEFAULT_MAX_SEARCH_PAGES = 50;
const LISTAINMUEBLES_POST_TIMEOUT_MS = 45_000;
const HABITACLIA_HTTP_SEARCH_TIMEOUT_MS = 90_000;
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
  refs: readonly { sourceId: string; url: string; listing?: HabitacliaRawListing }[],
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
      // Carried from discover to fetch through the documented `hints` channel.
      // See `fetch()` for why this is not merely an optimisation.
      hints: ref.listing ? { listing: ref.listing } : undefined,
    });
    yielded.count += 1;
  }
  return out;
}

export interface HabitacliaProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class HabitacliaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private readonly maxSearchPages: number;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: HabitacliaProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : habitacliaCitiesFromEnv();
    this.metrics = options.metrics ?? defaultProviderMetrics;
    this.maxSearchPages = providerMaxSearchPages(PROVIDER_ID, DEFAULT_MAX_SEARCH_PAGES, 'ES');
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    const yielded = { count: 0 };
    const runtime = job.runtime ?? this.runtime;

    // HTTP-first: the server-rendered `-<page>.htm` search paginates fully over
    // plain HTTP GET, so cold HTTP covers every page without a browser. Cities
    // Imperva challenges over cold HTTP fall through to the warmed session.
    const browserFallbackCities: string[] = [];
    for (const city of cities) {
      if (yielded.count >= limit) return;
      const http = { challenged: false };
      for await (const ref of this.discoverCityViaHttp(runtime, city, job.signal, seen, limit, yielded, http)) {
        yield ref;
      }
      // Escalate ONLY cities cold HTTP was actually blocked on — a city that
      // simply has no (more) listings resolved fine over HTTP and must not open
      // an expensive browser session.
      if (http.challenged) browserFallbackCities.push(city);
    }
    if (yielded.count >= limit) return;

    // Browser FALLBACK only for cities cold HTTP couldn't crack — a single
    // warmed Playwright session with same-origin `listainmuebles` POST
    // pagination, not a per-page `page.goto` (which times out via the proxy).
    if (browserFallbackCities.length > 0 && runtime.openBrowserSession) {
      for await (const ref of this.discoverViaListainmueblesSession(
        runtime,
        browserFallbackCities,
        job.signal,
        seen,
        limit,
        yielded,
      )) {
        yield ref;
      }
    }
  }

  /**
   * HTTP-first search pagination: GET each `/alquiler-<city>-<page>.htm` server
   * page through the residential proxy and parse its `data-href` cards. These
   * canonical paginated URLs return real listings cold (no Playwright), so this
   * replaces the old browser `page.goto` deep-page loop that timed out via the
   * proxy. Stops on a challenge/error page, an empty page, or the first page
   * that adds no new refs (portals clamp `-<page>.htm` to the last real page).
   */
  private async *discoverCityViaHttp(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
    http: { challenged: boolean },
  ): AsyncIterable<ExternalListingRef> {
    for (let page = 1; page <= this.maxSearchPages; page += 1) {
      if (yielded.count >= limit) return;
      const url = habitacliaWarmSearchUrl(city, page);
      const start = Date.now();
      let status: number;
      let body: string;
      try {
        ({ status, body } = await runtime.fetchHttp(url, {
          signal,
          proxyCountry: ES_PROXY_COUNTRY,
          timeoutMs: HABITACLIA_HTTP_SEARCH_TIMEOUT_MS,
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          },
        }));
      } catch (error) {
        // A proxy timeout / network error on one page must not abort discover;
        // mark the city challenged so it falls through to the warmed session.
        http.challenged = true;
        this.metrics.record({
          provider: this.id,
          strategy: 'http',
          outcome: 'error',
          latencyMs: Date.now() - start,
          url,
          detail: error instanceof Error ? error.message : String(error),
        });
        break;
      }

      const outcome = classifyOutcome(status, body, isHabitacliaChallenge);
      if (outcome !== 'success') {
        // Blocked (challenge/forbidden/error) — record it (health) and escalate.
        http.challenged = true;
        this.metrics.record({
          provider: this.id,
          strategy: 'http',
          outcome,
          status,
          latencyMs: Date.now() - start,
          url,
        });
        break;
      }

      // JSON FIRST, MARKUP SECOND. The portal ships its whole result set as
      // embedded JSON; the card markup the regex parser reads was rebuilt in
      // 2026-09 and now matches nothing. See ../adevinta/initialProps.ts.
      const jsonPage = parseHabitacliaSearchJson(body);
      const pageRefs = jsonPage ? jsonPage.refs : parseHabitacliaSearch(body);

      // THREE OUTCOMES, AND COLLAPSING ANY TWO OF THEM IS THE BUG THIS FIXES.
      //   * payload read, listings present  -> yield them
      //   * payload read, zero listings     -> city genuinely exhausted, stop
      //   * NO PAYLOAD AT ALL               -> we could not read the page
      // The third used to be indistinguishable from the second: a 200 whose
      // markup we no longer understand parsed to zero refs and was reported as
      // an exhausted city, silently, for every city, for weeks.
      //
      // THE CONDITION IS "WE LEARNED NOTHING ABOUT THIS CITY", not "this page
      // was empty". Running off the end of pagination also yields an empty page
      // with no payload — on the legacy markup that is the NORMAL way a city
      // finishes, and escalating there would open a browser session at the end
      // of every successful city. So this only fires while the city has still
      // produced nothing at all.
      if (!jsonPage && pageRefs.length === 0 && yielded.count === 0) {
        http.challenged = true;
        this.metrics.record({
          provider: this.id,
          strategy: 'http',
          outcome: 'error',
          status,
          latencyMs: Date.now() - start,
          url,
          detail: 'search page carried no readable listing payload',
        });
        break;
      }

      if (pageRefs.length === 0) break;
      const newRefs = yieldRefs(pageRefs, seen, limit, yielded);
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'success',
        status,
        latencyMs: Date.now() - start,
        url,
      });
      for (const ref of newRefs) {
        yield ref;
      }
      // The payload states its own page count, so stop at the end of the result
      // set instead of spending `maxSearchPages` requests discovering it. For a
      // small city that is the difference between 2 requests and 100.
      if (jsonPage?.totalPages !== undefined && page >= jsonPage.totalPages) break;
      if (page > 1 && newRefs.length === 0) break;
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
      proxyCountry: ES_PROXY_COUNTRY,
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
        warmUrl: habitacliaWarmHomeUrl(),
        contentSelector: HABITACLIA_LISTING_CARD_SELECTOR,
        isChallenge: isHabitacliaChallenge,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        reloadAfterPolls: 4,
        postChallengeSettleMs: 1_500,
        challengeWaitMs: 60_000,
        signal,
      });

      for (const city of cities) {
        if (yielded.count >= limit) return;

        await session.warmNavigate({
          ...this.habitacliaSessionOptions(city, sticky),
          signal,
        });

        const searchHtml = await session.content();
        const formFields = extractHabitacliaListadoFormFields(searchHtml);
        if (Object.keys(formFields).length === 0) continue;

        for (let page = 1; page <= this.maxSearchPages; page += 1) {
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

  /**
   * Return the listing, fetching the detail page only when we have to.
   *
   * **THE DETAIL PAGE IS NO LONGER A SOURCE OF DATA.** After the 2026-09
   * redesign it renders client-side: no JSON-LD, no embedded props, nothing a
   * server-side parser can read — verified against a live listing, which
   * returned 200 and 577 KB containing zero structured blocks. Everything the
   * ingest needs now lives in the SEARCH payload, which `discover` already
   * parsed, so it is carried here on the ref.
   *
   * That makes skipping the fetch a correctness requirement that happens to be
   * the cheap path too: one request per 30 listings instead of 31. Barcelona's
   * 3,269 rentals cost 109 requests instead of 3,378.
   *
   * The ladder remains for refs with no carried listing — anything queued
   * before this shipped, and any future path that yields bare refs. It will
   * fail on today's markup; that is honest, and it fails loudly as a job error
   * rather than quietly as an empty result.
   */
  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const carried = asRecord(ref.hints)?.['listing'];
    if (carried) return { ref, payload: asHabitaclia(carried) };

    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isHabitacliaChallenge,
      init: { signal: ctx.signal, proxyCountry: ES_PROXY_COUNTRY },
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
      yearBuilt: listing.yearBuilt,
      parkingSpaces: listing.parkingSpaces,
      amenities: listing.amenities,
      furnishedStatus: resolveFurnished(listing.furnished),
      remoteImages: toRemoteImages(listing),
      // Only ever what the portal actually returned — AGENTS.md is explicit
      // that a contact is never invented. Omitted entirely when absent, so the
      // app falls back to opening `sourceUrl` exactly as before.
      contact: listing.contact,
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
