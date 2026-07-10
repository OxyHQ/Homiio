/**
 * pisos.com provider (Spain) — JSON-first.
 *
 * Acquisition:
 *   - `discover()`: city rental search pages → schema.org JSON-LD cards (structured
 *     listing refs). Optional Playwright session warm-up when the ladder challenges.
 *   - `fetch()`: detail page embedded JSON (`data-var` + tracking blob) for price /
 *     rooms / m² / phone; best-effort `/WebsiteUserInfo/GetNormalizedPhone` AJAX.
 *   - HTML is last-resort for title/images/description only.
 *
 * Registered OFF by default (`PROVIDER_PISOS_ENABLED`).
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
import type { EsSchemaListing } from '../es/jsonLd';
import { PISOS_BASE_URL } from './fixtures';
import { parsePisosContactPhone, pisosContactPhoneUrl, pisosSearchUrl } from './ajax';
import {
  mergePisosContact,
  parsePisosDetail,
  parsePisosSearch,
  pisosSourceIdFromUrl,
  type PisosRaw,
} from './parse';

const PROVIDER_ID: ProviderId = 'pisos';
const DEFAULT_CITIES: readonly string[] = ['madrid', 'barcelona', 'valencia', 'sevilla', 'malaga'];
const MAX_SEARCH_PAGES = 3;

export function isPisosChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /access denied|captcha|datadome|precondition failed/i.test(html);
}

export interface PisosProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function resolvePropertyType(types: readonly string[]): PropertyType {
  const lower = types.map((type) => type.toLowerCase());
  if (lower.some((type) => type.includes('house') || type.includes('chalet'))) return PropertyType.HOUSE;
  if (lower.some((type) => type.includes('studio'))) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(listing: EsSchemaListing): NormalizedRemoteImage[] {
  return listing.images.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function asPisosRaw(payload: unknown): PisosRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; listing?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.listing !== 'object'
  ) {
    throw new Error('pisos: normalize received a payload that is not a PisosRaw');
  }
  return payload as PisosRaw;
}

export class PisosProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: PisosProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;
    const runtime = job.runtime ?? this.runtime;

    for (const city of cities) {
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded >= limit) return;
        const url = pisosSearchUrl(city, page);

        // Prefer warmed-session fetch when available (JSON-LD still in HTML shell).
        let html: string | undefined;
        if (runtime.openBrowserSession) {
          html = await this.fetchSearchViaSession(runtime, url, job.signal);
        }
        if (!html) {
          const result = await fetchListingViaLadder(runtime, url, {
            provider: this.id,
            isChallenge: isPisosChallenge,
            metrics: this.metrics,
            init: { signal: job.signal },
          });
          html = result.html;
        }

        const refs = parsePisosSearch(html);
        if (refs.length === 0) break;
        for (const ref of refs) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yield { provider: this.id, sourceId: ref.sourceId, url: ref.url };
          yielded += 1;
        }
      }
    }
  }

  private async fetchSearchViaSession(
    runtime: FetchRuntime,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const start = Date.now();
    let session: Awaited<ReturnType<NonNullable<FetchRuntime['openBrowserSession']>>> | undefined;
    try {
      session = await runtime.openBrowserSession({
        warmUrl: url,
        signal,
        contentSelector: 'script[type="application/ld+json"], h1, main',
        isChallenge: isPisosChallenge,
        challengeWaitMs: 30_000,
        blockAssets: true,
      });
      const html = await session.content();
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: isPisosChallenge(html) ? 'challenge' : 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url,
      });
      return isPisosChallenge(html) ? undefined : html;
    } catch {
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'error',
        latencyMs: Date.now() - start,
        url,
        detail: 'pisos search session warm-up failed',
      });
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isPisosChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    let payload = parsePisosDetail(html, ref.url);

    // Best-effort contact AJAX — never fail ingest on 403/empty.
    try {
      const contactUrl = pisosContactPhoneUrl(payload.sourceId);
      if (ctx.runtime.openBrowserSession) {
        const session = await ctx.runtime.openBrowserSession({
          warmUrl: ref.url,
          signal: ctx.signal,
          contentSelector: 'h1, #hdnIdPiso',
          isChallenge: isPisosChallenge,
          challengeWaitMs: 20_000,
          blockAssets: true,
        });
        try {
          const { status, body } = await session.request(contactUrl, {
            referer: ref.url,
            timeoutMs: 15_000,
          });
          if (status >= 200 && status < 300) {
            payload = mergePisosContact(payload, parsePisosContactPhone(body));
          }
        } finally {
          await session.close();
        }
      } else {
        const body = await ctx.runtime.fetchText(contactUrl, {
          headers: {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: ref.url,
          },
          signal: ctx.signal,
        });
        payload = mergePisosContact(payload, parsePisosContactPhone(body));
      }
    } catch {
      // Contact is optional.
    }

    return { ref, payload };
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, listing, contact } = asPisosRaw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`pisos: listing ${sourceId} has no resolvable price`);
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
    if (contact && (contact.phone || contact.email || contact.whatsapp || contact.agencyName)) {
      result.contact = contact;
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
      detail: `Serving ES via ${PISOS_BASE_URL} (JSON-LD discover + embedded detail JSON)`,
    };
  }
}

export { pisosSourceIdFromUrl };
