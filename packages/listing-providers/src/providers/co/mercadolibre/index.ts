/**
 * MercadoLibre Colombia inmuebles — classifieds, HOUSING ONLY.
 *
 * Thin wrapper over shared {@link ../../../mercadolibre} + {@link ../../../mercadolibreProvider}.
 * Bot/suspicious-traffic gated; keep OFF until live Playwright + residential proxy probe.
 * Registered OFF by default (`PROVIDER_MERCADOLIBRE_CO_ENABLED`).
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
import { MERCADOLIBRE_CO_BASE_URL, MERCADOLIBRE_CO_HOUSING_SLUGS } from './fixtures';

export const MERCADOLIBRE_CO_SITE: MercadolibreSiteConfig = {
  provider: 'mercadolibre_co',
  siteId: 'MCO',
  countryCode: 'CO',
  defaultCity: 'Bogotá D.C.',
  defaultCurrency: 'COP',
  inmueblesBaseUrl: MERCADOLIBRE_CO_BASE_URL,
  housingSlugs: MERCADOLIBRE_CO_HOUSING_SLUGS,
  // Colombia rents are advertised as "arriendo" (not "alquiler").
  rentSegment: 'arriendo',
  hrefRe:
    /href="(https:\/\/(?:departamento|casa|inmueble|ph|monoambiente)[^"]*mercadolibre\.com\.co\/MCO-?\d+[^"]*)"/i,
};

const DEFAULT_CITIES: readonly string[] = [
  'bogota-dc',
  'medellin',
  'cali',
  'barranquilla',
  'cartagena',
];

export interface MercadolibreCoProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class MercadolibreCoProvider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: MercadolibreCoProviderOptions = {}) {
    this.inner = createMercadolibreProvider({
      id: 'mercadolibre_co',
      markets: ['CO'],
      site: MERCADOLIBRE_CO_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-CO',
      acceptLanguage: 'es-CO,es;q=0.9,en;q=0.8',
      countryName: 'Colombia',
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

export const isMercadolibreCoChallenge = isMercadolibreChallenge;

export function mercadolibreCoSourceIdFromUrl(url: string) {
  return mercadolibreSourceIdFromUrl('MCO', url);
}

export function isMercadolibreCoHousingCategory(
  category: string | undefined,
  domainId: string | undefined,
) {
  return isMercadolibreHousingCategory(category, domainId);
}

export function mercadolibreCoHousingSearchUrl(city: string, page = 1) {
  return mercadolibreHousingSearchUrl(MERCADOLIBRE_CO_SITE, city, page);
}

export function parseMercadolibreCoSearchJson(body: string) {
  return parseMercadolibreSearchJson(MERCADOLIBRE_CO_SITE, body);
}

export function parseMercadolibreCoSearch(html: string) {
  return parseMercadolibreSearch(MERCADOLIBRE_CO_SITE, html);
}

export function parseMercadolibreCoDetail(html: string, url: string) {
  return parseMercadolibreDetail(MERCADOLIBRE_CO_SITE, html, url);
}

export function parseMercadolibreCoItemJson(body: string, fallbackUrl: string) {
  return parseMercadolibreItemJson(MERCADOLIBRE_CO_SITE, body, fallbackUrl);
}
