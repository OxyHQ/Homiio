/**
 * MercadoLibre Peru inmuebles — classifieds, HOUSING ONLY.
 *
 * Thin wrapper over shared {@link ../../../mercadolibre} + {@link ../../../mercadolibreProvider}.
 * Bot/suspicious-traffic gated; keep OFF until live Playwright + residential proxy probe.
 * Registered OFF by default (`PROVIDER_MERCADOLIBRE_PE_ENABLED`).
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
import { MERCADOLIBRE_PE_BASE_URL, MERCADOLIBRE_PE_HOUSING_SLUGS } from './fixtures';

export const MERCADOLIBRE_PE_SITE: MercadolibreSiteConfig = {
  provider: 'mercadolibre_pe',
  siteId: 'MPE',
  countryCode: 'PE',
  defaultCity: 'Lima',
  defaultCurrency: 'PEN',
  inmueblesBaseUrl: MERCADOLIBRE_PE_BASE_URL,
  housingSlugs: MERCADOLIBRE_PE_HOUSING_SLUGS,
  hrefRe:
    /href="(https:\/\/(?:departamento|casa|inmueble|ph|monoambiente)[^"]*mercadolibre\.com\.pe\/MPE-?\d+[^"]*)"/i,
};

const DEFAULT_CITIES: readonly string[] = ['lima', 'arequipa', 'trujillo', 'cusco'];

export interface MercadolibrePeProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class MercadolibrePeProvider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: MercadolibrePeProviderOptions = {}) {
    this.inner = createMercadolibreProvider({
      id: 'mercadolibre_pe',
      markets: ['PE'],
      site: MERCADOLIBRE_PE_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-PE',
      acceptLanguage: 'es-PE,es;q=0.9,en;q=0.8',
      countryName: 'Peru',
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

export const isMercadolibrePeChallenge = isMercadolibreChallenge;

export function mercadolibrePeSourceIdFromUrl(url: string) {
  return mercadolibreSourceIdFromUrl('MPE', url);
}

export function isMercadolibrePeHousingCategory(
  category: string | undefined,
  domainId: string | undefined,
) {
  return isMercadolibreHousingCategory(category, domainId);
}

export function mercadolibrePeHousingSearchUrl(city: string, page = 1) {
  return mercadolibreHousingSearchUrl(MERCADOLIBRE_PE_SITE, city, page);
}

export function parseMercadolibrePeSearchJson(body: string) {
  return parseMercadolibreSearchJson(MERCADOLIBRE_PE_SITE, body);
}

export function parseMercadolibrePeSearch(html: string) {
  return parseMercadolibreSearch(MERCADOLIBRE_PE_SITE, html);
}

export function parseMercadolibrePeDetail(html: string, url: string) {
  return parseMercadolibreDetail(MERCADOLIBRE_PE_SITE, html, url);
}

export function parseMercadolibrePeItemJson(body: string, fallbackUrl: string) {
  return parseMercadolibreItemJson(MERCADOLIBRE_PE_SITE, body, fallbackUrl);
}
