/**
 * MercadoLibre Chile inmuebles — classifieds, HOUSING ONLY.
 *
 * Thin wrapper over shared {@link ../../../mercadolibre} + {@link ../../../mercadolibreProvider}.
 * Bot/suspicious-traffic gated; keep OFF until live Playwright + residential proxy probe.
 * Registered OFF by default (`PROVIDER_MERCADOLIBRE_CL_ENABLED`).
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
import { MERCADOLIBRE_CL_BASE_URL, MERCADOLIBRE_CL_HOUSING_SLUGS } from './fixtures';

export const MERCADOLIBRE_CL_SITE: MercadolibreSiteConfig = {
  provider: 'mercadolibre_cl',
  siteId: 'MLC',
  countryCode: 'CL',
  defaultCity: 'Santiago',
  defaultCurrency: 'CLP',
  inmueblesBaseUrl: MERCADOLIBRE_CL_BASE_URL,
  housingSlugs: MERCADOLIBRE_CL_HOUSING_SLUGS,
  rentSegment: 'arriendo',
  hrefRe:
    /href="(https:\/\/(?:departamento|casa|inmueble|ph|monoambiente)[^"]*mercadolibre\.cl\/MLC-?\d+[^"]*)"/i,
};

const DEFAULT_CITIES: readonly string[] = [
  'santiago-rm',
  'valparaiso',
  'concepcion-biobio',
  'vina-del-mar',
];

export interface MercadolibreClProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class MercadolibreClProvider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: MercadolibreClProviderOptions = {}) {
    this.inner = createMercadolibreProvider({
      id: 'mercadolibre_cl',
      markets: ['CL'],
      site: MERCADOLIBRE_CL_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-CL',
      acceptLanguage: 'es-CL,es;q=0.9,en;q=0.8',
      countryName: 'Chile',
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

export const isMercadolibreClChallenge = isMercadolibreChallenge;

export function mercadolibreClSourceIdFromUrl(url: string) {
  return mercadolibreSourceIdFromUrl('MLC', url);
}

export function isMercadolibreClHousingCategory(
  category: string | undefined,
  domainId: string | undefined,
) {
  return isMercadolibreHousingCategory(category, domainId);
}

export function mercadolibreClHousingSearchUrl(city: string, page = 1) {
  return mercadolibreHousingSearchUrl(MERCADOLIBRE_CL_SITE, city, page, 'arriendo');
}

export function parseMercadolibreClSearchJson(body: string) {
  return parseMercadolibreSearchJson(MERCADOLIBRE_CL_SITE, body);
}

export function parseMercadolibreClSearch(html: string) {
  return parseMercadolibreSearch(MERCADOLIBRE_CL_SITE, html);
}

export function parseMercadolibreClDetail(html: string, url: string) {
  return parseMercadolibreDetail(MERCADOLIBRE_CL_SITE, html, url);
}

export function parseMercadolibreClItemJson(body: string, fallbackUrl: string) {
  return parseMercadolibreItemJson(MERCADOLIBRE_CL_SITE, body, fallbackUrl);
}
