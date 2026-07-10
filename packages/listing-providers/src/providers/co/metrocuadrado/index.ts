/**
 * Metrocuadrado (Colombia) — Navent JSON/AJAX + Playwright session.
 *
 * Thin wrapper over shared {@link ../../../navent} + {@link ../../../naventProvider}.
 * Cloudflare-gated; keep OFF until sticky residential session clears discover.
 * Registered OFF by default (`PROVIDER_METROCUADRADO_ENABLED`).
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
import { METROCUADRADO_BASE_URL } from './fixtures';

export const METROCUADRADO_SITE: NaventSiteConfig = {
  provider: 'metrocuadrado',
  baseUrl: METROCUADRADO_BASE_URL,
  countryCode: 'CO',
  defaultCity: 'Bogotá D.C.',
  defaultCurrency: 'COP',
  hrefRe:
    /href="((?:https:\/\/www\.metrocuadrado\.com)?\/propiedades\/[^"]+-(\d{5,})\.html)"/i,
};

const DEFAULT_CITIES: readonly string[] = [
  'bogota',
  'medellin',
  'cali',
  'barranquilla',
  'cartagena',
];

export interface MetrocuadradoProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class MetrocuadradoProvider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: MetrocuadradoProviderOptions = {}) {
    this.inner = createNaventProvider({
      id: 'metrocuadrado',
      markets: ['CO'],
      site: METROCUADRADO_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-CO',
      acceptLanguage: 'es-CO,es;q=0.9,en;q=0.8',
      countryName: 'Colombia',
      searchUrl: (city, page, kind) => {
        const op = kind === 'alquiler' ? 'arriendo' : 'venta';
        const base = `${METROCUADRADO_BASE_URL}/apartamentos/${op}/${citySlug(city)}`;
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

export const isMetrocuadradoChallenge = isNaventChallenge;
export const metrocuadradoSourceIdFromUrl = naventSourceIdFromUrl;

export function parseMetrocuadradoSearchJson(body: string) {
  return parseNaventSearchJson(METROCUADRADO_SITE, body);
}

export function parseMetrocuadradoSearch(html: string) {
  return parseNaventSearch(METROCUADRADO_SITE, html);
}

export function parseMetrocuadradoDetail(html: string, url: string) {
  return parseNaventDetail(METROCUADRADO_SITE, html, url);
}

export function parseMetrocuadradoPostingJson(body: string, fallbackUrl: string) {
  return parseNaventPostingJson(METROCUADRADO_SITE, body, fallbackUrl);
}
