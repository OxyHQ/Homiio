/**
 * Argenprop provider (Argentina) — Navent JSON/AJAX + Playwright session.
 *
 * Thin wrapper over shared {@link ../../../navent} + {@link ../../../naventProvider}.
 * Registered OFF by default (`PROVIDER_ARGENPROP_ENABLED`).
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
import { ARGENPROP_BASE_URL } from './fixtures';

export const ARGENPROP_SITE: NaventSiteConfig = {
  provider: 'argenprop',
  baseUrl: ARGENPROP_BASE_URL,
  countryCode: 'AR',
  defaultCity: 'Buenos Aires',
  defaultCurrency: 'ARS',
  hrefRe:
    /href="((?:https:\/\/www\.argenprop\.com)?\/[^"]*?--(\d{6,})(?:\.html)?(?:\?[^"]*)?)"/i,
};

const DEFAULT_CITIES: readonly string[] = [
  'capital-federal',
  'cordoba',
  'rosario',
  'mendoza',
  'la-plata',
];

export interface ArgenpropProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function argenpropSearchUrl(city: string, page: number, kind: 'alquiler' | 'venta'): string {
  const slug = citySlug(city);
  const base = `${ARGENPROP_BASE_URL}/departamento-${kind}-${slug}`;
  return page <= 1 ? base : `${base}?pagina-${page}`;
}

export class ArgenpropProvider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: ArgenpropProviderOptions = {}) {
    this.inner = createNaventProvider({
      id: 'argenprop',
      markets: ['AR'],
      site: ARGENPROP_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-AR',
      acceptLanguage: 'es-AR,es;q=0.9,en;q=0.8',
      countryName: 'Argentina',
      searchUrl: argenpropSearchUrl,
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

export const isArgenpropChallenge = isNaventChallenge;
export const argenpropSourceIdFromUrl = naventSourceIdFromUrl;

export function parseArgenpropSearchJson(body: string) {
  return parseNaventSearchJson(ARGENPROP_SITE, body);
}

export function parseArgenpropSearch(html: string) {
  return parseNaventSearch(ARGENPROP_SITE, html);
}

export function parseArgenpropDetail(html: string, url: string) {
  return parseNaventDetail(ARGENPROP_SITE, html, url);
}

export function parseArgenpropPostingJson(body: string, fallbackUrl: string) {
  return parseNaventPostingJson(ARGENPROP_SITE, body, fallbackUrl);
}
