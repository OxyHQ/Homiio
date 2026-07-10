/**
 * `@homiio/listing-providers`
 *
 * Plugin-based listing providers for the Homiio market aggregator. Exposes the
 * provider CONTRACT ({@link ListingProvider} et al.), the shared
 * {@link FetchRuntime} implementation, the {@link ProviderRegistry}, and the
 * Phase-0 {@link FixtureProvider}. The backend worker imports this package; the
 * API/Express process must NOT (it never scrapes).
 */

export * from './types';
export * from './runtime';
export * from './browser';
export * from './proxy';
export * from './managed';
export * from './registry';
export * from './metrics';
export * from './strategy';
export { FixtureProvider } from './providers/fixture';
export { FIXTURE_LISTINGS } from './providers/fixture/fixtures';
export type { FixtureRawListing, FixtureRawImage } from './providers/fixture/fixtures';

export { HabitacliaProvider } from './providers/habitaclia';
export {
  parseHabitacliaDetail,
  parseHabitacliaSearch,
  habitacliaSourceIdFromUrl,
} from './providers/habitaclia/parse';
export {
  HABITACLIA_FIXTURE_DETAIL_HTML,
  HABITACLIA_FIXTURE_SEARCH_HTML,
} from './providers/habitaclia/fixtures';
export type {
  HabitacliaRawListing,
  HabitacliaRawImage,
} from './providers/habitaclia/fixtures';

export { BluegroundProvider, coerceBluegroundListing } from './providers/blueground';
export {
  parseBluegroundDetail,
  parseBluegroundSearch,
  bluegroundCitySearchUrl,
  bluegroundSourceIdFromUrl,
} from './providers/blueground/parse';
export { BLUEGROUND_FIXTURES } from './providers/blueground/fixtures';
export type {
  BluegroundRawListing,
  BluegroundRawPhoto,
} from './providers/blueground/fixtures';

export { IdealistaProvider, isIdealistaChallenge, idealistaSourceIdFromUrl } from './providers/idealista';
export { parseIdealistaDetail, parseIdealistaSearch, type IdealistaRaw } from './providers/idealista/parse';
export {
  IDEALISTA_BASE_URL,
  IDEALISTA_FIXTURE_DETAIL_HTML,
  IDEALISTA_FIXTURE_SALE_DETAIL_HTML,
  IDEALISTA_FIXTURE_SEARCH_HTML,
} from './providers/idealista/fixtures';

export { FotocasaProvider, isFotocasaChallenge, fotocasaSourceIdFromUrl } from './providers/fotocasa';
export { parseFotocasaDetail, parseFotocasaSearch, type FotocasaRaw } from './providers/fotocasa/parse';
export {
  FOTOCASA_BASE_URL,
  FOTOCASA_FIXTURE_DETAIL_HTML,
  FOTOCASA_FIXTURE_SEARCH_HTML,
} from './providers/fotocasa/fixtures';

export {
  extractEsSchemaListings,
  pickEsListing,
  type EsSchemaListing,
} from './providers/es/jsonLd';

// Shared US-market schema.org JSON-LD parser (apartments.com + Zillow).
export {
  extractSchemaOrgListings,
  pickPrimaryListing,
  type SchemaOrgListing,
} from './providers/us/jsonLd';

// apartments.com (US) — feature-flagged OFF by default.
export {
  ApartmentsComProvider,
  parseApartmentsComSearch,
  parseApartmentsComDetail,
  type ApartmentsComRaw,
} from './providers/us/apartmentsCom';
export {
  APARTMENTS_COM_DETAIL_FIXTURES,
  APARTMENTS_COM_SEARCH_FIXTURE,
  type RecordedPage,
} from './providers/us/apartmentsCom/fixtures';

// Zillow (US) — feature-flagged OFF by default.
export {
  ZillowProvider,
  parseZillowSearch,
  parseZillowDetail,
  type ZillowRaw,
  type ZillowKind,
} from './providers/us/zillow';
export {
  ZILLOW_DETAIL_FIXTURES,
  ZILLOW_SEARCH_FIXTURE,
  type RecordedZillowPage,
} from './providers/us/zillow/fixtures';

import type { ProviderId } from '@homiio/shared-types';
import { ProviderRegistry } from './registry';
import type { ListingProvider } from './types';
import { FixtureProvider } from './providers/fixture';
import { HabitacliaProvider } from './providers/habitaclia';
import { BluegroundProvider } from './providers/blueground';
import { IdealistaProvider } from './providers/idealista';
import { FotocasaProvider } from './providers/fotocasa';
import { ApartmentsComProvider } from './providers/us/apartmentsCom';
import { ZillowProvider } from './providers/us/zillow';

/**
 * Configurable ES discover cities from `LISTING_ES_CITIES` (comma-separated).
 * When unset, each ES provider falls back to its own default city list.
 */
function esCitiesFromEnv(): string[] {
  return (process.env.LISTING_ES_CITIES ?? '')
    .split(',')
    .map((city) => city.trim())
    .filter(Boolean);
}

/**
 * Whether a real portal provider is enabled via its env feature flag. Flags are
 * `PROVIDER_<ID>_ENABLED` (e.g. `PROVIDER_HABITACLIA_ENABLED`) and default OFF —
 * a portal only ingests once its flag is explicitly `"true"`.
 */
function providerEnabled(id: ProviderId): boolean {
  return process.env[`PROVIDER_${id.toUpperCase()}_ENABLED`] === 'true';
}

/**
 * Build the default registry. The Phase-0 `fixture` provider is always on (it
 * touches no external portal); every real portal plugin is gated behind its
 * `PROVIDER_<ID>_ENABLED` flag and OFF by default. New portal plugins register
 * by appending to `flaggedProviders` — each stays a self-contained module.
 */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry([new FixtureProvider()]);
  const esCities = esCitiesFromEnv();
  const esOptions = esCities.length > 0 ? { cities: esCities } : {};
  const flaggedProviders: ListingProvider[] = [
    new HabitacliaProvider(),
    new BluegroundProvider(),
    new IdealistaProvider(esOptions),
    new FotocasaProvider(esOptions),
    new ApartmentsComProvider(),
    new ZillowProvider(),
  ];
  for (const provider of flaggedProviders) {
    if (providerEnabled(provider.id)) {
      registry.register(provider);
    }
  }
  return registry;
}
