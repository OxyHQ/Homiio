/**
 * Zonaprop provider (Argentina) — Navent JSON/AJAX + Playwright session.
 *
 * Thin wrapper over shared {@link ../../../navent} + {@link ../../../naventProvider}.
 * Registered OFF by default (`PROVIDER_ZONAPROP_ENABLED`).
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
import type { FetchRuntime, ListingProvider } from '../../../types';
import type { ProviderMetricsReader, ProviderMetricsSink } from '../../../metrics';
import { ZONAPROP_BASE_URL } from './fixtures';

export const ZONAPROP_SITE: NaventSiteConfig = {
  provider: 'zonaprop',
  baseUrl: ZONAPROP_BASE_URL,
  countryCode: 'AR',
  defaultCity: 'Buenos Aires',
  defaultCurrency: 'ARS',
  hrefRe:
    /href="((?:https:\/\/www\.zonaprop\.com\.ar)?\/propiedades\/[^"]+-(\d{5,})\.html)"/i,
};

const DEFAULT_CITIES: readonly string[] = [
  'capital-federal',
  'cordoba',
  'rosario',
  'mendoza',
  'la-plata',
];

export interface ZonapropProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class ZonapropProvider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: ZonapropProviderOptions = {}) {
    this.inner = createNaventProvider({
      id: 'zonaprop',
      markets: ['AR'],
      site: ZONAPROP_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-AR',
      acceptLanguage: 'es-AR,es;q=0.9,en;q=0.8',
      countryName: 'Argentina',
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

export const isZonapropChallenge = isNaventChallenge;
export const zonapropSourceIdFromUrl = naventSourceIdFromUrl;

export function parseZonapropSearchJson(body: string) {
  return parseNaventSearchJson(ZONAPROP_SITE, body);
}

export function parseZonapropSearch(html: string) {
  return parseNaventSearch(ZONAPROP_SITE, html);
}

export function parseZonapropDetail(html: string, url: string) {
  return parseNaventDetail(ZONAPROP_SITE, html, url);
}

export function parseZonapropPostingJson(body: string, fallbackUrl: string) {
  return parseNaventPostingJson(ZONAPROP_SITE, body, fallbackUrl);
}
