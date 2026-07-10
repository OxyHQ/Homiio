/**
 * Plusvalía (Ecuador) — Navent JSON/AJAX + Playwright session.
 *
 * Thin wrapper over shared {@link ../../../navent} + {@link ../../../naventProvider}.
 * Cloudflare-gated; keep OFF until sticky residential session clears discover.
 * Registered OFF by default (`PROVIDER_PLUSVALIA_ENABLED`).
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
import { PLUSVALIA_BASE_URL } from './fixtures';

export const PLUSVALIA_SITE: NaventSiteConfig = {
  provider: 'plusvalia',
  baseUrl: PLUSVALIA_BASE_URL,
  countryCode: 'EC',
  defaultCity: 'Quito',
  defaultCurrency: 'USD',
  hrefRe:
    /href="((?:https:\/\/www\.plusvalia\.com)?\/propiedades\/[^"]+-(\d{5,})\.html)"/i,
};

const DEFAULT_CITIES: readonly string[] = [
  'quito',
  'guayaquil',
  'cuenca',
  'manta',
  'ambato',
];

export interface PlusvaliaProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class PlusvaliaProvider implements ListingProvider {
  readonly id: ProviderId;
  readonly markets: ListingProvider['markets'];
  private readonly inner: ListingProvider;

  constructor(options: PlusvaliaProviderOptions = {}) {
    this.inner = createNaventProvider({
      id: 'plusvalia',
      markets: ['EC'],
      site: PLUSVALIA_SITE,
      defaultCities: DEFAULT_CITIES,
      locale: 'es-EC',
      acceptLanguage: 'es-EC,es;q=0.9,en;q=0.8',
      countryName: 'Ecuador',
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

export const isPlusvaliaChallenge = isNaventChallenge;
export const plusvaliaSourceIdFromUrl = naventSourceIdFromUrl;

export function parsePlusvaliaSearchJson(body: string) {
  return parseNaventSearchJson(PLUSVALIA_SITE, body);
}

export function parsePlusvaliaSearch(html: string) {
  return parseNaventSearch(PLUSVALIA_SITE, html);
}

export function parsePlusvaliaDetail(html: string, url: string) {
  return parseNaventDetail(PLUSVALIA_SITE, html, url);
}

export function parsePlusvaliaPostingJson(body: string, fallbackUrl: string) {
  return parseNaventPostingJson(PLUSVALIA_SITE, body, fallbackUrl);
}
