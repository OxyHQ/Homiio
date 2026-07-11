/**
 * MercadoLibre Mexico inmuebles — classifieds, HOUSING ONLY.
 *
 * Thin wrapper over shared {@link ../../../mercadolibre} + {@link ../../../mercadolibreProvider}.
 * Cold HTTP works for search + detail HTML (verified — no account-verification wall
 * from datacenter IPs, unlike CO/CL/PE/EC); item API is OAuth-gated. Registered OFF
 * by default (`PROVIDER_MERCADOLIBRE_MX_ENABLED`) — enable after live probe.
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
import { MERCADOLIBRE_MX_BASE_URL, MERCADOLIBRE_MX_HOUSING_SLUGS } from './fixtures';

export const MERCADOLIBRE_MX_SITE: MercadolibreSiteConfig = {
  provider: 'mercadolibre_mx',
  siteId: 'MLM',
  countryCode: 'MX',
  defaultCity: 'Ciudad de México',
  defaultCurrency: 'MXN',
  inmueblesBaseUrl: MERCADOLIBRE_MX_BASE_URL,
  housingSlugs: MERCADOLIBRE_MX_HOUSING_SLUGS,
  rentSegment: 'renta',
  hrefRe:
    /href="(https:\/\/(?:departamento|casa|inmueble|ph|monoambiente)[^"]*mercadolibre\.com\.mx\/MLM-?\d+[^"]*)"/i,
};

const DEFAULT_CITIES: readonly string[] = [
  'ciudad-de-mexico',
  'guadalajara',
  'monterrey',
  'queretaro',
  'puebla',
];

export interface MercadolibreMxProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class MercadolibreMxProvider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: MercadolibreMxProviderOptions = {}) {
    this.inner = createMercadolibreProvider({
      id: 'mercadolibre_mx',
      markets: ['MX'],
      site: MERCADOLIBRE_MX_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-MX',
      acceptLanguage: 'es-MX,es;q=0.9,en;q=0.8',
      countryName: 'Mexico',
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

export const isMercadolibreMxChallenge = isMercadolibreChallenge;

export function mercadolibreMxSourceIdFromUrl(url: string) {
  return mercadolibreSourceIdFromUrl('MLM', url);
}

export function isMercadolibreMxHousingCategory(
  category: string | undefined,
  domainId: string | undefined,
) {
  return isMercadolibreHousingCategory(category, domainId);
}

export function mercadolibreMxHousingSearchUrl(city: string, page = 1) {
  return mercadolibreHousingSearchUrl(MERCADOLIBRE_MX_SITE, city, page, 'renta');
}

export function parseMercadolibreMxSearchJson(body: string) {
  return parseMercadolibreSearchJson(MERCADOLIBRE_MX_SITE, body);
}

export function parseMercadolibreMxSearch(html: string) {
  return parseMercadolibreSearch(MERCADOLIBRE_MX_SITE, html);
}

export function parseMercadolibreMxDetail(html: string, url: string) {
  return parseMercadolibreDetail(MERCADOLIBRE_MX_SITE, html, url);
}

export function parseMercadolibreMxItemJson(body: string, fallbackUrl: string) {
  return parseMercadolibreItemJson(MERCADOLIBRE_MX_SITE, body, fallbackUrl);
}
