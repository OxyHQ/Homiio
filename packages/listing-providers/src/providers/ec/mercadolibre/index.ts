/**
 * MercadoLibre Ecuador inmuebles — classifieds, HOUSING ONLY.
 *
 * Thin wrapper over shared {@link ../../../mercadolibre} + {@link ../../../mercadolibreProvider}.
 * Bot/suspicious-traffic gated; keep OFF until live Playwright + residential proxy probe.
 * Registered OFF by default (`PROVIDER_MERCADOLIBRE_EC_ENABLED`).
 */

import type { ProviderId } from '@homiio/shared-types';
import {
  isMercadolibreChallenge,
  isMercadolibreHousingCategory,
  mercadolibreHousingSearchUrl,
  mercadolibreSourceIdFromUrl,
  parseMercadolibreDetail,
  parseMercadolibreItemJson,
  parseMercadolibreSearch,
  parseMercadolibreSearchJson,
  type MercadolibreSiteConfig,
} from '../../../mercadolibre';
import { createMercadolibreProvider } from '../../../mercadolibreProvider';
import type { FetchRuntime, ListingProvider } from '../../../types';
import type { ProviderMetricsReader, ProviderMetricsSink } from '../../../metrics';
import { MERCADOLIBRE_EC_BASE_URL, MERCADOLIBRE_EC_HOUSING_SLUGS } from './fixtures';

export const MERCADOLIBRE_EC_SITE: MercadolibreSiteConfig = {
  provider: 'mercadolibre_ec',
  siteId: 'MEC',
  countryCode: 'EC',
  defaultCity: 'Quito',
  defaultCurrency: 'USD',
  inmueblesBaseUrl: MERCADOLIBRE_EC_BASE_URL,
  housingSlugs: MERCADOLIBRE_EC_HOUSING_SLUGS,
  hrefRe:
    /href="(https:\/\/(?:departamento|casa|inmueble|ph|monoambiente)[^"]*mercadolibre\.com\.ec\/MEC-?\d+[^"]*)"/i,
};

const DEFAULT_CITIES: readonly string[] = ['quito', 'guayaquil', 'cuenca'];

export interface MercadolibreEcProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class MercadolibreEcProvider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: MercadolibreEcProviderOptions = {}) {
    this.inner = createMercadolibreProvider({
      id: 'mercadolibre_ec',
      markets: ['EC'],
      site: MERCADOLIBRE_EC_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-EC',
      acceptLanguage: 'es-EC,es;q=0.9,en;q=0.8',
      countryName: 'Ecuador',
      requireBrowserSession: true,
      runtime: options.runtime,
      cities: options.cities,
      metrics: options.metrics,
    });
    this.id = this.inner.id;
    this.markets = this.inner.markets;
  }

  discover(job: Parameters<ListingProvider['discover']>[0]) {
    return this.inner.discover(job);
  }

  fetch(...args: Parameters<ListingProvider['fetch']>) {
    return this.inner.fetch(...args);
  }

  normalize(...args: Parameters<ListingProvider['normalize']>) {
    return this.inner.normalize(...args);
  }

  health() {
    return this.inner.health();
  }
}

export const isMercadolibreEcChallenge = isMercadolibreChallenge;

export function mercadolibreEcSourceIdFromUrl(url: string) {
  return mercadolibreSourceIdFromUrl('MEC', url);
}

export function isMercadolibreEcHousingCategory(
  category: string | undefined,
  domainId: string | undefined,
) {
  return isMercadolibreHousingCategory(category, domainId);
}

export function mercadolibreEcHousingSearchUrl(city: string, page = 1) {
  return mercadolibreHousingSearchUrl(MERCADOLIBRE_EC_SITE, city, page);
}

export function parseMercadolibreEcSearchJson(body: string) {
  return parseMercadolibreSearchJson(MERCADOLIBRE_EC_SITE, body);
}

export function parseMercadolibreEcSearch(html: string) {
  return parseMercadolibreSearch(MERCADOLIBRE_EC_SITE, html);
}

export function parseMercadolibreEcDetail(html: string, url: string) {
  return parseMercadolibreDetail(MERCADOLIBRE_EC_SITE, html, url);
}

export function parseMercadolibreEcItemJson(body: string, fallbackUrl: string) {
  return parseMercadolibreItemJson(MERCADOLIBRE_EC_SITE, body, fallbackUrl);
}
