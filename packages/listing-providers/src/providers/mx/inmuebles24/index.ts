/**
 * Inmuebles24 provider (Mexico) — Navent JSON/AJAX + Playwright session.
 *
 * Thin wrapper over shared {@link ../../../navent} + {@link ../../../naventProvider}.
 * Cloudflare-gated; keep OFF until sticky residential session clears discover.
 * Registered OFF by default (`PROVIDER_INMUEBLES24_ENABLED`).
 */

import type { ProviderId } from '@homiio/shared-types';
import {
  isNaventChallenge,
  naventSourceIdFromUrl,
  parseNaventDetail,
  parseNaventPostingJson,
  parseNaventSearch,
  parseNaventSearchJson,
  type NaventSiteConfig,
} from '../../../navent';
import { createNaventProvider } from '../../../naventProvider';
import { citySlug } from '../../../slug';
import type { FetchRuntime, ListingProvider } from '../../../types';
import type { ProviderMetricsReader, ProviderMetricsSink } from '../../../metrics';
import { INMUEBLES24_BASE_URL } from './fixtures';

export const INMUEBLES24_SITE: NaventSiteConfig = {
  provider: 'inmuebles24',
  baseUrl: INMUEBLES24_BASE_URL,
  countryCode: 'MX',
  defaultCity: 'Ciudad de México',
  defaultCurrency: 'MXN',
  hrefRe:
    /href="((?:https:\/\/www\.inmuebles24\.com)?\/propiedades\/[^"]+-(\d{5,})\.html)"/i,
};

const DEFAULT_CITIES: readonly string[] = [
  'ciudad-de-mexico',
  'guadalajara',
  'monterrey',
  'puebla',
  'queretaro',
];

export interface Inmuebles24ProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class Inmuebles24Provider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: Inmuebles24ProviderOptions = {}) {
    this.inner = createNaventProvider({
      id: 'inmuebles24',
      markets: ['MX'],
      site: INMUEBLES24_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-MX',
      acceptLanguage: 'es-MX,es;q=0.9,en;q=0.8',
      countryName: 'Mexico',
      searchUrl: (city, page, kind) => {
        const op = kind === 'alquiler' ? 'renta' : 'venta';
        const base = `${INMUEBLES24_BASE_URL}/departamentos-en-${op}-en-${citySlug(city)}.html`;
        return page <= 1 ? base : `${base}?pagina=${page}`;
      },
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

export const isInmuebles24Challenge = isNaventChallenge;
export const inmuebles24SourceIdFromUrl = naventSourceIdFromUrl;

export function parseInmuebles24SearchJson(body: string) {
  return parseNaventSearchJson(INMUEBLES24_SITE, body);
}

export function parseInmuebles24Search(html: string) {
  return parseNaventSearch(INMUEBLES24_SITE, html);
}

export function parseInmuebles24Detail(html: string, url: string) {
  return parseNaventDetail(INMUEBLES24_SITE, html, url);
}

export function parseInmuebles24PostingJson(body: string, fallbackUrl: string) {
  return parseNaventPostingJson(INMUEBLES24_SITE, body, fallbackUrl);
}
