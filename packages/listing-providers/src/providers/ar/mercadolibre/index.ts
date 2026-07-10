/**
 * MercadoLibre Argentina inmuebles — classifieds, HOUSING ONLY.
 *
 * Thin wrapper over shared {@link ../../../mercadolibre} + {@link ../../../mercadolibreProvider}.
 * Cold HTTP works for search/detail HTML; item API is often IP-gated.
 * Registered OFF by default (`PROVIDER_MERCADOLIBRE_AR_ENABLED`) — enable after live probe.
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
import { MERCADOLIBRE_AR_BASE_URL, MERCADOLIBRE_AR_HOUSING_SLUGS } from './fixtures';

export const MERCADOLIBRE_AR_SITE: MercadolibreSiteConfig = {
  provider: 'mercadolibre_ar',
  siteId: 'MLA',
  countryCode: 'AR',
  defaultCity: 'Capital Federal',
  defaultCurrency: 'ARS',
  inmueblesBaseUrl: MERCADOLIBRE_AR_BASE_URL,
  housingSlugs: MERCADOLIBRE_AR_HOUSING_SLUGS,
  hrefRe:
    /href="(https:\/\/(?:departamento|casa|inmueble|ph|monoambiente)[^"]*mercadolibre\.com\.ar\/MLA-?\d+[^"]*)"/i,
};

const DEFAULT_CITIES: readonly string[] = [
  'capital-federal',
  'cordoba',
  'rosario',
  'mendoza',
  'la-plata',
];

export interface MercadolibreArProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class MercadolibreArProvider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: MercadolibreArProviderOptions = {}) {
    this.inner = createMercadolibreProvider({
      id: 'mercadolibre_ar',
      markets: ['AR'],
      site: MERCADOLIBRE_AR_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-AR',
      acceptLanguage: 'es-AR,es;q=0.9,en;q=0.8',
      countryName: 'Argentina',
      requireBrowserSession: false,
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

export const isMercadolibreArChallenge = isMercadolibreChallenge;

export function mercadolibreArSourceIdFromUrl(url: string) {
  return mercadolibreSourceIdFromUrl('MLA', url);
}

export function isMercadolibreArHousingCategory(
  category: string | undefined,
  domainId: string | undefined,
) {
  return isMercadolibreHousingCategory(category, domainId);
}

export function mercadolibreArHousingSearchUrl(city: string, page = 1) {
  return mercadolibreHousingSearchUrl(MERCADOLIBRE_AR_SITE, city, page);
}

export function parseMercadolibreArSearchJson(body: string) {
  return parseMercadolibreSearchJson(MERCADOLIBRE_AR_SITE, body);
}

export function parseMercadolibreArSearch(html: string) {
  return parseMercadolibreSearch(MERCADOLIBRE_AR_SITE, html);
}

export function parseMercadolibreArDetail(html: string, url: string) {
  return parseMercadolibreDetail(MERCADOLIBRE_AR_SITE, html, url);
}

export function parseMercadolibreArItemJson(body: string, fallbackUrl: string) {
  return parseMercadolibreItemJson(MERCADOLIBRE_AR_SITE, body, fallbackUrl);
}
