/**
 * Properati Ecuador provider — OFF; portal returns ALB 403 from probes.
 * Implements the contract for future enablement once session clears.
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
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
} from '../../../types';
import { createFetchRuntime } from '../../../runtime';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { citySlug } from '../../../slug';
import { PROPERATI_EC_BASE_URL } from './fixtures';
import {
  isProperatiEcChallenge,
  parseProperatiEcDetail,
  parseProperatiEcSearchJson,
  type ProperatiEcRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'properati_ec';
const DEFAULT_CITIES: readonly string[] = ['quito', 'guayaquil'];

export interface ProperatiEcProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): ProperatiEcRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; price?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('properati_ec: normalize received an invalid payload');
  }
  return payload as ProperatiEcRawListing;
}

export class ProperatiEcProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['EC'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: ProperatiEcProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const runtime = job.runtime ?? this.runtime;
    let yielded = 0;
    const seen = new Set<string>();

    if (!runtime.openBrowserSession) return;

    for (const city of cities) {
      if (yielded >= limit) return;
      const warmUrl = `${PROPERATI_EC_BASE_URL}/s/${citySlug(city)}/alquiler/departamento`;
      const start = Date.now();
      let session: Awaited<ReturnType<NonNullable<FetchRuntime['openBrowserSession']>>> | undefined;
      try {
        session = await runtime.openBrowserSession({
          warmUrl,
          signal: job.signal,
          contentSelector: 'a[href*="/detalle/"], main, script',
          isChallenge: isProperatiEcChallenge,
          challengeWaitMs: 45_000,
          blockAssets: true,
          locale: 'es-EC',
          acceptLanguage: 'es-EC,es;q=0.9',
        });
        const html = await session.content();
        if (isProperatiEcChallenge(html)) {
          this.metrics.record({
            provider: this.id,
            strategy: 'browser',
            outcome: 'challenge',
            latencyMs: Date.now() - start,
            url: warmUrl,
          });
          return;
        }
        // Prefer any embedded JSON array; otherwise empty (portal not viable yet).
        const jsonMatch = html.match(/\{"data"\s*:\s*\[[\s\S]*?\]\s*\}/);
        const refs = jsonMatch ? parseProperatiEcSearchJson(jsonMatch[0]) : [];
        for (const ref of refs) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yield { provider: this.id, sourceId: ref.sourceId, url: ref.url };
          yielded += 1;
        }
      } catch {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          latencyMs: Date.now() - start,
          url: warmUrl,
          detail: 'properati_ec session failed (ALB 403 likely)',
        });
        return;
      } finally {
        await session?.close();
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (!ctx.runtime.openBrowserSession) {
      throw new Error('properati_ec: fetch requires openBrowserSession');
    }
    const session = await ctx.runtime.openBrowserSession({
      warmUrl: ref.url,
      signal: ctx.signal,
      contentSelector: 'script[type="application/ld+json"], main, h1',
      isChallenge: isProperatiEcChallenge,
      challengeWaitMs: 45_000,
      blockAssets: true,
      locale: 'es-EC',
    });
    try {
      const html = await session.content();
      if (isProperatiEcChallenge(html)) {
        throw new Error('properati_ec: detail challenged');
      }
      return { ref, payload: parseProperatiEcDetail(html, ref.url) };
    } finally {
      await session.close();
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
        country: 'Ecuador',
        countryCode: 'EC',
      },
      type: PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: listing.images.map((url, index) => ({ url, isPrimary: index === 0 })),
      status: 'published',
    };
    if (listing.description) result.description = listing.description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'degraded',
      detail: `${PROPERATI_EC_BASE_URL} ALB 403 in probes — keep OFF until session clears`,
    };
  }
}

export {
  isProperatiEcChallenge,
  parseProperatiEcDetail,
  parseProperatiEcSearchJson,
  properatiEcSourceIdFromUrl,
} from './parse';
