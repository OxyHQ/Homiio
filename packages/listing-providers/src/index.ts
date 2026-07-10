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
export * from './session';
export {
  PlaywrightSessionPool,
  warmSession,
  type BrowserSessionOptions,
  type PlaywrightSessionPoolOptions,
} from './browserSession';
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
  parseIdealistaGeoreach,
  idealistaGeoreachUrl,
  idealistaGeoreachSlug,
  idealistaWarmSearchUrl,
  isIdealistaGeoreachChallenge,
} from './providers/idealista/georeach';
export {
  parseIdealistaContactPhones,
  parseIdealistaContactInfo,
  mergeIdealistaContact,
  idealistaContactPhonesUrl,
  idealistaContactInfoUrl,
  isIdealistaContactChallenge,
  type IdealistaContact,
} from './providers/idealista/contact';
export {
  IDEALISTA_BASE_URL,
  IDEALISTA_FIXTURE_DETAIL_HTML,
  IDEALISTA_FIXTURE_SALE_DETAIL_HTML,
  IDEALISTA_FIXTURE_SEARCH_HTML,
  IDEALISTA_FIXTURE_GEOREACH_JSON,
  IDEALISTA_FIXTURE_GEOREACH_HTML_JSON,
  IDEALISTA_FIXTURE_GEOREACH_CHALLENGE,
  IDEALISTA_FIXTURE_CONTACT_PHONES_JSON,
  IDEALISTA_FIXTURE_CONTACT_INFO_JSON,
} from './providers/idealista/fixtures';

export { FotocasaProvider, isFotocasaChallenge, fotocasaSourceIdFromUrl } from './providers/fotocasa';
export { parseFotocasaDetail, parseFotocasaSearch, type FotocasaRaw } from './providers/fotocasa/parse';
export {
  FOTOCASA_BASE_URL,
  FOTOCASA_FIXTURE_DETAIL_HTML,
  FOTOCASA_FIXTURE_SEARCH_HTML,
  FOTOCASA_FIXTURE_REAL_ESTATE_LISTING_HTML,
  FOTOCASA_FIXTURE_NEXT_DATA_HTML,
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

// realtor.com (US) — GraphQL JSON, feature-flagged OFF by default.
export {
  RealtorComProvider,
  parseRealtorSearchResponse,
  parseRealtorDetailResponse,
  parseRealtorListingNode,
  type RealtorComRaw,
} from './providers/us/realtorCom';
export {
  REALTOR_COM_BASE_URL,
  REALTOR_COM_RENT_FIXTURE,
  REALTOR_COM_SALE_FIXTURE,
  REALTOR_COM_SEARCH_FIXTURE,
  type RecordedRealtorListing,
} from './providers/us/realtorCom/fixtures';
export {
  REALTOR_GRAPHQL_URL,
  REALTOR_GRAPHQL_HEADERS,
  realtorSearchBody,
  realtorDetailBody,
  isRealtorGraphqlChallenge,
  type RealtorKind,
} from './providers/us/realtorCom/api';

// HotPads (US) — public JSON API, feature-flagged OFF by default.
export {
  HotpadsProvider,
  parseHotpadsSearch,
  parseHotpadsListingById,
  parseHotpadsArea,
  type HotpadsRaw,
} from './providers/us/hotpads';
export {
  HOTPADS_API_BASE,
  HOTPADS_BASE_URL,
  HOTPADS_AREA_FIXTURE,
  HOTPADS_LISTING_FIXTURE,
  HOTPADS_SEARCH_FIXTURE,
  type HotpadsListingFixture,
} from './providers/us/hotpads/fixtures';

// Redfin (US) — Stingray JSON via browser session, feature-flagged OFF by default.
export {
  RedfinProvider,
  parseRedfinGisResponse,
  parseRedfinDetailResponse,
  redfinKindFromHome,
  type RedfinRaw,
} from './providers/us/redfin';
export {
  REDFIN_BASE_URL,
  REDFIN_GIS_FIXTURE,
  REDFIN_INITIAL_INFO_FIXTURE,
  type RedfinHomeFixture,
} from './providers/us/redfin/fixtures';
export {
  redfinGisUrl,
  redfinWarmUrl,
  redfinInitialInfoUrl,
  isRedfinStingrayChallenge,
  REDFIN_CONTENT_SELECTOR,
  type RedfinKind,
} from './providers/us/redfin/api';

export { DEFAULT_US_CITIES, cityToResourceSlug, stripStingrayPrefix } from './providers/us/portals';

// GB market — Rightmove / Zoopla / OnTheMarket / OpenRent.
export {
  RightmoveProvider,
  isRightmoveChallenge,
  rightmoveSourceIdFromUrl,
} from './providers/gb/rightmove';
export {
  parseRightmoveDetail,
  parseRightmoveSearchJson,
  parseRightmoveTypeahead,
  type RightmoveListingJson,
} from './providers/gb/rightmove/parse';
export {
  RIGHTMOVE_BASE_URL,
  RIGHTMOVE_FIXTURE_DETAIL_HTML,
  RIGHTMOVE_FIXTURE_SEARCH_HTML,
  RIGHTMOVE_FIXTURE_TYPEAHEAD_JSON,
} from './providers/gb/rightmove/fixtures';

export {
  ZooplaProvider,
  isZooplaChallenge,
  zooplaSourceIdFromUrl,
} from './providers/gb/zoopla';
export {
  parseZooplaDetail,
  parseZooplaSearch,
  type ZooplaListingJson,
} from './providers/gb/zoopla/parse';
export {
  ZOOPLA_BASE_URL,
  ZOOPLA_FIXTURE_DETAIL_HTML,
  ZOOPLA_FIXTURE_SEARCH_HTML,
} from './providers/gb/zoopla/fixtures';

export {
  OnTheMarketProvider,
  isOnTheMarketChallenge,
  onthemarketSourceIdFromUrl,
} from './providers/gb/onthemarket';
export {
  parseOnTheMarketDetail,
  parseOnTheMarketSearch,
  type OnTheMarketListingJson,
} from './providers/gb/onthemarket/parse';
export {
  ONTHEMARKET_BASE_URL,
  ONTHEMARKET_FIXTURE_DETAIL_HTML,
  ONTHEMARKET_FIXTURE_SEARCH_HTML,
  ONTHEMARKET_FIXTURE_GARAGE_HTML,
} from './providers/gb/onthemarket/fixtures';

export {
  OpenRentProvider,
  isOpenRentChallenge,
  openrentSourceIdFromUrl,
} from './providers/gb/openrent';
export {
  parseOpenRentDetail,
  parseOpenRentSearch,
  type OpenRentListingJson,
} from './providers/gb/openrent/parse';
export {
  OPENRENT_BASE_URL,
  OPENRENT_FIXTURE_DETAIL_HTML,
  OPENRENT_FIXTURE_SEARCH_HTML,
} from './providers/gb/openrent/fixtures';

// DE market — ImmobilienScout24 (mobile JSON) / Immowelt (SERP JSON) / Kleinanzeigen (housing-only).
export {
  ImmobilienScout24Provider,
  is24SourceIdFromUrl,
  is24PublicUrl,
  parseIs24Search,
  parseIs24Expose,
} from './providers/de/immobilienscout24';
export {
  IMMOBILIENSCOUT24_BASE_URL,
  IMMOBILIENSCOUT24_MOBILE_API,
  IS24_FIXTURE_SEARCH_JSON,
  IS24_FIXTURE_EXPOSE_JSON,
} from './providers/de/immobilienscout24/fixtures';

export {
  ImmoweltProvider,
  immoweltSourceIdFromUrl,
  immoweltExposeUrl,
  parseImmoweltSearch,
  parseImmoweltDetail,
} from './providers/de/immowelt';
export {
  IMMOWELT_BASE_URL,
  IMMOWELT_FIXTURE_CARD_JSON,
  IMMOWELT_FIXTURE_SEARCH_HTML,
} from './providers/de/immowelt/fixtures';
export {
  parseImmoweltCard,
  parseImmoweltSearchCards,
  isImmoweltChallenge,
  type ImmoweltRawListing,
} from './providers/de/immowelt/parse';

export {
  KleinanzeigenProvider,
  kleinanzeigenSourceIdFromUrl,
  kleinanzeigenHousingSearchUrl,
  parseKleinanzeigenSearch,
  parseKleinanzeigenDetail,
  isKleinanzeigenHousingCategory,
} from './providers/de/kleinanzeigen';
export {
  KLEINANZEIGEN_BASE_URL,
  KLEINANZEIGEN_HOUSING_CATEGORY_IDS,
  KLEINANZEIGEN_FIXTURE_SEARCH_HTML,
  KLEINANZEIGEN_FIXTURE_DETAIL_HTML,
  KLEINANZEIGEN_FIXTURE_NON_HOUSING_HTML,
} from './providers/de/kleinanzeigen/fixtures';

// ES — pisos.com (JSON-LD + embedded detail JSON), feature-flagged OFF by default.
export { PisosProvider, isPisosChallenge, pisosSourceIdFromUrl } from './providers/pisos';
export {
  parsePisosDetail,
  parsePisosSearch,
  mergePisosContact,
  type PisosRaw,
} from './providers/pisos/parse';
export {
  PISOS_BASE_URL,
  PISOS_FIXTURE_DETAIL_HTML,
  PISOS_FIXTURE_SEARCH_HTML,
  PISOS_FIXTURE_CONTACT_JSON,
} from './providers/pisos/fixtures';
export {
  pisosSearchUrl,
  pisosContactPhoneUrl,
  parsePisosContactPhone,
} from './providers/pisos/ajax';

// ES — milanuncios (classifieds, housing-only), OFF by default — do not enable in prod until verified.
export {
  MilanunciosProvider,
  isMilanunciosChallenge,
  milanunciosSourceIdFromUrl,
  normalizeMilanunciosRaw,
  parseMilanunciosAdvert,
} from './providers/milanuncios';
export {
  parseMilanunciosSearchJson,
  type MilanunciosRaw,
} from './providers/milanuncios/parse';
export {
  MILANUNCIOS_BASE_URL,
  MILANUNCIOS_HOUSING_CATEGORY_SLUGS,
  MILANUNCIOS_HOUSING_CATEGORY_IDS,
  MILANUNCIOS_FIXTURE_HOUSING_JSON,
  MILANUNCIOS_FIXTURE_CAR_JSON,
  MILANUNCIOS_FIXTURE_SEARCH_JSON,
  milanunciosHousingSearchUrl,
  milanunciosListAjaxUrl,
} from './providers/milanuncios/fixtures';

export {
  assertHousingListing,
  isHousingCategory,
  isHousingCategoryUrl,
  NonHousingListingError,
} from './providers/es/housing';

// ES — yaencontre / indomio (Cloudflare-gated; OFF).
export { YaencontreProvider, isYaencontreChallenge } from './providers/yaencontre';
export {
  parseYaencontreDetailJson,
  parseYaencontreSearchJson,
  normalizeYaencontreRaw,
  type YaencontreRaw,
} from './providers/yaencontre/parse';
export {
  YAENCONTRE_BASE_URL,
  YAENCONTRE_FIXTURE_DETAIL_JSON,
  YAENCONTRE_FIXTURE_SEARCH_JSON,
} from './providers/yaencontre/fixtures';

export { IndomioProvider, isIndomioChallenge } from './providers/indomio';
export {
  parseIndomioDetailJson,
  parseIndomioSearchJson,
  normalizeIndomioRaw,
  type IndomioRaw,
} from './providers/indomio/parse';
export {
  INDOMIO_BASE_URL,
  INDOMIO_FIXTURE_DETAIL_JSON,
  INDOMIO_FIXTURE_SEARCH_JSON,
} from './providers/indomio/fixtures';

// Italy market — AJAX/JSON-first + Playwright session pattern.
export {
  IdealistaItProvider,
  isIdealistaItChallenge,
  idealistaItSourceIdFromUrl,
} from './providers/it/idealistaIt';
export {
  parseIdealistaItDetail,
  parseIdealistaItSearch,
  type IdealistaItRaw,
} from './providers/it/idealistaIt/parse';
export {
  parseIdealistaItGeoreach,
  idealistaItGeoreachUrl,
  idealistaItWarmSearchUrl,
  isIdealistaItGeoreachChallenge,
} from './providers/it/idealistaIt/georeach';
export {
  IDEALISTA_IT_BASE_URL,
  IDEALISTA_IT_FIXTURE_DETAIL_HTML,
  IDEALISTA_IT_FIXTURE_SEARCH_HTML,
  IDEALISTA_IT_FIXTURE_GEOREACH_JSON,
  IDEALISTA_IT_FIXTURE_CONTACT_JSON,
  IDEALISTA_IT_FIXTURE_GEOREACH_CHALLENGE,
} from './providers/it/idealistaIt/fixtures';
export {
  parseIdealistaItContactInfo,
  parseIdealistaItContactPhones,
  idealistaItContactPhonesUrl,
  idealistaItContactInfoUrl,
} from './providers/it/idealistaIt/contact';

export {
  ImmobiliareProvider,
  isImmobiliareChallenge,
  immobiliareSourceIdFromUrl,
} from './providers/it/immobiliare';
export {
  parseImmobiliareDetail,
  parseImmobiliareSearch,
  parseImmobiliareSearchJson,
  type ImmobiliareRaw,
} from './providers/it/immobiliare/parse';
export {
  IMMOBILIARE_BASE_URL,
  IMMOBILIARE_FIXTURE_DETAIL_HTML,
  IMMOBILIARE_FIXTURE_SEARCH_HTML,
  IMMOBILIARE_FIXTURE_SEARCH_JSON,
} from './providers/it/immobiliare/fixtures';

export { CasaItProvider, isCasaItChallenge, casaItSourceIdFromUrl } from './providers/it/casaIt';
export {
  parseCasaItDetail,
  parseCasaItSearch,
  parseCasaItSearchJson,
  type CasaItRaw,
} from './providers/it/casaIt/parse';
export {
  CASA_IT_BASE_URL,
  CASA_IT_FIXTURE_DETAIL_HTML,
  CASA_IT_FIXTURE_SEARCH_HTML,
  CASA_IT_FIXTURE_SEARCH_JSON,
} from './providers/it/casaIt/fixtures';

export {
  SubitoProvider,
  isSubitoChallenge,
  subitoSourceIdFromUrl,
  isSubitoHousingCategory,
} from './providers/it/subito';
export {
  parseSubitoDetail,
  parseSubitoSearch,
  parseSubitoSearchJson,
  type SubitoRaw,
} from './providers/it/subito/parse';
export {
  SUBITO_BASE_URL,
  SUBITO_FIXTURE_DETAIL_HTML,
  SUBITO_FIXTURE_NON_HOUSING_HTML,
  SUBITO_FIXTURE_SEARCH_HTML,
  SUBITO_FIXTURE_SEARCH_JSON,
} from './providers/it/subito/fixtures';

export {
  extractItSchemaListings,
  pickItListing,
  type ItSchemaListing,
} from './providers/it/jsonLd';

import type { ProviderId } from '@homiio/shared-types';
import { ProviderRegistry } from './registry';
import type { ListingProvider } from './types';
import { FixtureProvider } from './providers/fixture';
import { HabitacliaProvider } from './providers/habitaclia';
import { BluegroundProvider } from './providers/blueground';
import { IdealistaProvider } from './providers/idealista';
import { FotocasaProvider } from './providers/fotocasa';
import { PisosProvider } from './providers/pisos';
import { MilanunciosProvider } from './providers/milanuncios';
import { YaencontreProvider } from './providers/yaencontre';
import { IndomioProvider } from './providers/indomio';
import { ApartmentsComProvider } from './providers/us/apartmentsCom';
import { ZillowProvider } from './providers/us/zillow';
import { RealtorComProvider } from './providers/us/realtorCom';
import { HotpadsProvider } from './providers/us/hotpads';
import { RedfinProvider } from './providers/us/redfin';
import { RightmoveProvider } from './providers/gb/rightmove';
import { ZooplaProvider } from './providers/gb/zoopla';
import { OnTheMarketProvider } from './providers/gb/onthemarket';
import { OpenRentProvider } from './providers/gb/openrent';
import { IdealistaItProvider } from './providers/it/idealistaIt';
import { ImmobiliareProvider } from './providers/it/immobiliare';
import { CasaItProvider } from './providers/it/casaIt';
import { SubitoProvider } from './providers/it/subito';
import { ImmobilienScout24Provider } from './providers/de/immobilienscout24';
import { ImmoweltProvider } from './providers/de/immowelt';
import { KleinanzeigenProvider } from './providers/de/kleinanzeigen';

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

/** Configurable GB discover cities from `LISTING_GB_CITIES` (comma-separated). */
function gbCitiesFromEnv(): string[] {
  return (process.env.LISTING_GB_CITIES ?? '')
    .split(',')
    .map((city) => city.trim())
    .filter(Boolean);
}

/** Configurable US discover cities from `LISTING_US_CITIES` (comma-separated). */
function usCitiesFromEnv(): string[] {
  return (process.env.LISTING_US_CITIES ?? '')
    .split(',')
    .map((city) => city.trim())
    .filter(Boolean);
}

/** Configurable IT discover cities from `LISTING_IT_CITIES` (comma-separated). */
function itCitiesFromEnv(): string[] {
  return (process.env.LISTING_IT_CITIES ?? '')
    .split(',')
    .map((city) => city.trim())
    .filter(Boolean);
}

/** Configurable DE discover cities from `LISTING_DE_CITIES` (comma-separated). */
function deCitiesFromEnv(): string[] {
  return (process.env.LISTING_DE_CITIES ?? '')
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
  const gbCities = gbCitiesFromEnv();
  const gbOptions = gbCities.length > 0 ? { cities: gbCities } : {};
  const usCities = usCitiesFromEnv();
  const usOptions = usCities.length > 0 ? { cities: usCities } : {};
  const itCities = itCitiesFromEnv();
  const itOptions = itCities.length > 0 ? { cities: itCities } : {};
  const deCities = deCitiesFromEnv();
  const deOptions = deCities.length > 0 ? { cities: deCities } : {};
  const flaggedProviders: ListingProvider[] = [
    new HabitacliaProvider(),
    new BluegroundProvider(),
    new IdealistaProvider(esOptions),
    new FotocasaProvider(esOptions),
    new PisosProvider(esOptions),
    new MilanunciosProvider(esOptions),
    new YaencontreProvider(esOptions),
    new IndomioProvider(esOptions),
    new ApartmentsComProvider(),
    new ZillowProvider(),
    new RealtorComProvider(usOptions),
    new HotpadsProvider(usOptions),
    new RedfinProvider(usOptions),
    new RightmoveProvider(gbOptions),
    new ZooplaProvider(gbOptions),
    new OnTheMarketProvider(gbOptions),
    new OpenRentProvider(gbOptions),
    new IdealistaItProvider(itOptions),
    new ImmobiliareProvider(itOptions),
    new CasaItProvider(itOptions),
    new SubitoProvider(itOptions),
    new ImmobilienScout24Provider(deOptions),
    new ImmoweltProvider(deOptions),
    new KleinanzeigenProvider(deOptions),
  ];
  for (const provider of flaggedProviders) {
    if (providerEnabled(provider.id)) {
      registry.register(provider);
    }
  }
  return registry;
}
