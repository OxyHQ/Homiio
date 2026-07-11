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

export {
  isDataDomeAjaxChallenge,
  isDataDomeHtmlChallenge,
  isCloudflareChallenge,
} from './parse/challenge';
export {
  validateMonthlyRentAmount,
  validateNightlyRateAmount,
  validateSalePriceAmount,
  validateOfferingPrices,
  type MonthlyRentPriceContext,
  type OfferingPriceInput,
} from './parse/price';
export {
  ListingValidationError,
  validateNormalizedListing,
  sanitizeNormalizedListingTextFields,
  DEFAULT_MAX_REMOTE_IMAGES,
  type ValidateNormalizedListingOptions,
} from './parse/listing';
export { stripHtmlToPlainText } from './parse/htmlText';
export {
  assertHousingListing,
  isHousingCategory,
  isHousingCategoryUrl,
  NonHousingListingError,
  type HousingSignalInput,
} from './parse/classifieds';
export { isRecord, asString, asNumberEu, asNumberUs, asCoordinate, deaccent, firstString } from './parse/guards';

export { FixtureProvider } from './providers/fixture';
export { FIXTURE_LISTINGS } from './providers/fixture/fixtures';
export type { FixtureRawListing, FixtureRawImage } from './providers/fixture/fixtures';

export { HabitacliaProvider } from './providers/habitaclia';
export {
  habitacliaCitiesFromEnv,
  habitacliaCitiesOptionsFromEnv,
} from './providers/habitaclia/cities';
export {
  parseHabitacliaDetail,
  parseHabitacliaSearch,
  habitacliaSourceIdFromUrl,
} from './providers/habitaclia/parse';
export {
  HABITACLIA_CONTENT_SELECTOR,
  HABITACLIA_LISTAINMUEBLES_URL,
  buildHabitacliaListainmueblesBody,
  extractHabitacliaListadoFormFields,
  habitacliaWarmSearchUrl,
  isHabitacliaListainmueblesChallenge,
  parseHabitacliaListainmuebles,
} from './providers/habitaclia/listainmuebles';
export {
  HABITACLIA_FIXTURE_DETAIL_HTML,
  HABITACLIA_FIXTURE_DETAIL_HTML_LIVE,
  HABITACLIA_FIXTURE_DETAIL_HTML_PLACEHOLDER_SURFACE,
  HABITACLIA_FIXTURE_SEARCH_HTML,
} from './providers/habitaclia/fixtures';
export type {
  HabitacliaRawListing,
  HabitacliaRawImage,
} from './providers/habitaclia/fixtures';

export {
  BluegroundProvider,
  coerceBluegroundListing,
  BluegroundPartnerListingError,
  isBluegroundPartnerListing,
  readBluegroundAmenities,
  readBluegroundLowestRent,
  readBluegroundPartnerSignals,
} from './providers/blueground';
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
export {
  idealistaCitiesFromEnv,
  idealistaCitiesOptionsFromEnv,
} from './providers/idealista/cities';
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
export {
  fotocasaCitiesFromEnv,
  fotocasaCitiesOptionsFromEnv,
} from './providers/fotocasa/cities';
export { parseFotocasaDetail, parseFotocasaSearch, type FotocasaRaw } from './providers/fotocasa/parse';
export {
  parseFotocasaSearchads,
  parseFotocasaLocationSegments,
  parseFotocasaSsrSearch,
  extractFotocasaSearchCards,
  fotocasaSearchadsUrl,
  fotocasaUrlLocationSegmentsUrl,
  fotocasaWarmSearchUrl,
  fotocasaCityFromRefUrl,
  fotocasaPropertyApiUrl,
  isFotocasaSearchadsChallenge,
  FOTOCASA_GW_BASE,
} from './providers/fotocasa/searchads';
export {
  parseFotocasaPropertyJson,
  isFotocasaPropertyChallenge,
} from './providers/fotocasa/property';
export {
  readFotocasaBrowserSessionHint,
  FOTOCASA_BROWSER_SESSION_HINT,
  type FotocasaBrowserSessionHint,
} from './providers/fotocasa/sessionHints';
export {
  FOTOCASA_BASE_URL,
  FOTOCASA_FIXTURE_DETAIL_HTML,
  FOTOCASA_FIXTURE_SEARCH_HTML,
  FOTOCASA_FIXTURE_REAL_ESTATE_LISTING_HTML,
  FOTOCASA_FIXTURE_NEXT_DATA_HTML,
  FOTOCASA_FIXTURE_SEARCHADS_JSON,
  FOTOCASA_FIXTURE_LOCATION_SEGMENTS_JSON,
  FOTOCASA_FIXTURE_SEARCHADS_CHALLENGE,
  FOTOCASA_FIXTURE_PROPERTY_JSON,
  FOTOCASA_FIXTURE_SSR_SEARCH_HTML,
  fotocasaSearchadsPageFixture,
} from './providers/fotocasa/fixtures';

// FR market — Bien'ici / Leboncoin (housing 9/10) / SeLoger. All OFF by default.
export {
  BieniciProvider,
  isBieniciChallenge,
  parseBieniciDetail,
  parseBieniciSearch,
  resolveBieniciPrice,
  bieniciSourceIdFromUrl,
} from './providers/fr/bienici';
export {
  BIENICI_BASE_URL,
  BIENICI_FIXTURE_SEARCH_JSON,
  BIENICI_FIXTURE_DETAIL_JSON,
  BIENICI_FIXTURE_BUY_DETAIL_JSON,
} from './providers/fr/bienici/fixtures';
export { contactFromBieniciRelative } from './providers/fr/contact';
export {
  LeboncoinProvider,
  isLeboncoinChallenge,
  parseLeboncoinDetail,
  parseLeboncoinSearch,
  leboncoinSourceIdFromUrl,
} from './providers/fr/leboncoin';
export {
  LEBONCOIN_BASE_URL,
  LEBONCOIN_HOUSING_CATEGORY_IDS,
  LEBONCOIN_FIXTURE_FINDER_JSON,
  LEBONCOIN_FIXTURE_DETAIL_JSON,
} from './providers/fr/leboncoin/fixtures';
export {
  SelogerProvider,
  isSelogerChallenge,
  parseSelogerDetail,
  parseSelogerSearch,
  selogerSourceIdFromUrl,
  extractSelogerInitialData,
} from './providers/fr/seloger';
export {
  SELOGER_BASE_URL,
  SELOGER_FIXTURE_SEARCH_HTML,
  SELOGER_FIXTURE_DETAIL_HTML,
} from './providers/fr/seloger/fixtures';

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
  pisosCitiesFromEnv,
  pisosCitiesOptionsFromEnv,
} from './providers/pisos/cities';
export {
  readPisosBrowserSessionHint,
  pisosBrowserSessionHints,
  PISOS_BROWSER_SESSION_HINT,
  type PisosBrowserSessionHint,
} from './providers/pisos/sessionHints';
export {
  parsePisosDetail,
  parsePisosSearch,
  mergePisosContact,
  readPisosLocationMapCoordinates,
  readPisosAscendingGeo,
  postalCodeFromPisosUrl,
  type PisosRaw,
} from './providers/pisos/parse';
export {
  PISOS_BASE_URL,
  PISOS_FIXTURE_DETAIL_HTML,
  PISOS_FIXTURE_DETAIL_VALLADOLID_HTML,
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

// Romania — Storia (__NEXT_DATA__) / Imobiliare.ro (Inertia+JSON-LD) / OLX.ro (housing-only).
export {
  StoriaProvider,
  isStoriaChallenge,
  parseStoriaDetail,
  parseStoriaSearch,
  storiaSourceIdFromUrl,
} from './providers/ro/storia';
export {
  STORIA_BASE_URL,
  STORIA_FIXTURE_DETAIL_HTML,
  STORIA_FIXTURE_SEARCH_HTML,
} from './providers/ro/storia/fixtures';
export type { StoriaRawListing, StoriaSearchRef } from './providers/ro/storia/parse';

export {
  ImobiliareRoProvider,
  isImobiliareRoChallenge,
  parseImobiliareRoDetail,
  parseImobiliareRoSearch,
  imobiliareRoSourceIdFromUrl,
} from './providers/ro/imobiliare';
export {
  IMOBILIARE_RO_BASE_URL,
  IMOBILIARE_RO_FIXTURE_DETAIL_HTML,
  IMOBILIARE_RO_FIXTURE_SEARCH_HTML,
} from './providers/ro/imobiliare/fixtures';
export type {
  ImobiliareRoRawListing,
  ImobiliareRoSearchRef,
} from './providers/ro/imobiliare/parse';

export {
  OlxRoProvider,
  isOlxRoChallenge,
  isOlxRoHousingCategory,
  parseOlxRoDetail,
  parseOlxRoSearch,
  olxRoSourceIdFromUrl,
} from './providers/ro/olx';
export {
  OLX_RO_BASE_URL,
  OLX_RO_FIXTURE_DETAIL_HTML,
  OLX_RO_FIXTURE_NON_HOUSING_HTML,
  OLX_RO_FIXTURE_SEARCH_HTML,
} from './providers/ro/olx/fixtures';
export {
  OLX_RO_HOUSING_PATHS,
  OLX_RO_HOUSING_SLUGS,
  mergeOlxRoPhone,
} from './providers/ro/olx/parse';
export type { OlxRoRawListing, OlxRoSearchRef } from './providers/ro/olx/parse';

// Shared helpers — ONE chokepoint per concern (providers must not duplicate).
export {
  normalizePhone,
  normalizeWhatsapp,
  normalizeEmail,
  buildContact,
  mergeContact,
  mergeListingContact,
  contactFromUnknown,
  contactFromRecord,
  contactFromAjaxBody,
  extractContactFromHtml,
  hasContactFields,
  parseContactPhonesJson,
  type ListingContact,
} from './contact';
export {
  parseNextData,
  extractNextData,
  nextDataPageProps,
  parseNextDataPageProps,
  parsePreloadedState,
} from './nextData';
export {
  collectJsonLdNodes,
  jsonLdTypes,
  resolveJsonLdRef,
  findJsonLdByType,
} from './jsonLd';
export { citySlug } from './slug';
export {
  citiesFromEnv,
  citiesOptionsFromEnv,
  providerCitiesFromEnv,
  providerCitiesOptionsFromEnv,
  DEFAULT_MARKET_CITIES,
} from './cities';
export {
  MAX_PAGES_CEILING,
  maxSearchPagesFromEnv,
  providerMaxSearchPages,
} from './discoverLimits';


// Ecuador (EC) — Plusvalía (shared Navent) / MercadoLibre housing-only / Properati (OFF).
export {
  PlusvaliaProvider,
  PLUSVALIA_SITE,
  isPlusvaliaChallenge,
  plusvaliaSourceIdFromUrl,
  parsePlusvaliaDetail,
  parsePlusvaliaPostingJson,
  parsePlusvaliaSearch,
  parsePlusvaliaSearchJson,
} from './providers/ec/plusvalia';
export {
  PLUSVALIA_BASE_URL,
  PLUSVALIA_FIXTURE_DETAIL_HTML,
  PLUSVALIA_FIXTURE_SEARCH_HTML,
  PLUSVALIA_FIXTURE_SEARCH_JSON,
} from './providers/ec/plusvalia/fixtures';
export {
  MercadolibreEcProvider,
  MERCADOLIBRE_EC_SITE,
  isMercadolibreEcChallenge,
  isMercadolibreEcHousingCategory,
  mercadolibreEcHousingSearchUrl,
  mercadolibreEcSourceIdFromUrl,
  parseMercadolibreEcDetail,
  parseMercadolibreEcItemJson,
  parseMercadolibreEcSearch,
  parseMercadolibreEcSearchJson,
} from './providers/ec/mercadolibre';
export {
  MERCADOLIBRE_EC_BASE_URL,
  MERCADOLIBRE_EC_HOUSING_SLUGS,
  MERCADOLIBRE_EC_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_EC_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_EC_FIXTURE_SEARCH_HTML,
  MERCADOLIBRE_EC_FIXTURE_SEARCH_JSON,
} from './providers/ec/mercadolibre/fixtures';
export {
  ProperatiEcProvider,
  isProperatiEcChallenge,
  parseProperatiEcDetail,
  parseProperatiEcSearchJson,
  properatiEcSourceIdFromUrl,
} from './providers/ec/properati';
export {
  PROPERATI_EC_BASE_URL,
  PROPERATI_EC_FIXTURE_DETAIL_HTML,
  PROPERATI_EC_FIXTURE_SEARCH_JSON,
} from './providers/ec/properati/fixtures';

export {
  isNaventChallenge,
  parseNaventSearch,
  parseNaventSearchJson,
  parseNaventDetail,
  type NaventSiteConfig,
  type NaventRawListing,
} from './navent';


// Argentina (AR) — shared Navent/ML factories; housing-only for MercadoLibre.
export * from './providers/ar/exports';
export {
  isMercadolibreChallenge,
  isMercadolibreHousingCategory,
  parseMercadolibreSearch,
  parseMercadolibreDetail,
  type MercadolibreSiteConfig,
  type MercadolibreRawListing,
} from './mercadolibre';

// Mexico (MX) — Inmuebles24 (Navent) / Lamudi (JSON-LD) / Vivanuncios (housing-only) / Propiedades.
export {
  Inmuebles24Provider,
  isInmuebles24Challenge,
  inmuebles24SourceIdFromUrl,
  parseInmuebles24Search,
  parseInmuebles24SearchJson,
  parseInmuebles24Detail,
  parseInmuebles24PostingJson,
  INMUEBLES24_SITE,
} from './providers/mx/inmuebles24';
export {
  INMUEBLES24_BASE_URL,
  INMUEBLES24_FIXTURE_DETAIL_HTML,
  INMUEBLES24_FIXTURE_SEARCH_HTML,
  INMUEBLES24_FIXTURE_SEARCH_JSON,
} from './providers/mx/inmuebles24/fixtures';
export {
  LamudiProvider,
  isLamudiChallenge,
  lamudiSourceIdFromUrl,
  parseLamudiDetail,
  parseLamudiSearch,
} from './providers/mx/lamudi';
export {
  LAMUDI_BASE_URL,
  LAMUDI_FIXTURE_DETAIL_HTML,
  LAMUDI_FIXTURE_SEARCH_HTML,
} from './providers/mx/lamudi/fixtures';
export type { LamudiRawListing, LamudiSearchRef } from './providers/mx/lamudi/parse';
export {
  VivanunciosProvider,
  isVivanunciosChallenge,
  parseVivanunciosDetail,
  parseVivanunciosSearch,
  vivanunciosSourceIdFromUrl,
} from './providers/mx/vivanuncios';
export {
  VIVANUNCIOS_BASE_URL,
  VIVANUNCIOS_HOUSING_SLUGS,
  VIVANUNCIOS_FIXTURE_DETAIL_HTML,
  VIVANUNCIOS_FIXTURE_CAR_HTML,
  VIVANUNCIOS_FIXTURE_SEARCH_HTML,
} from './providers/mx/vivanuncios/fixtures';
export {
  PropiedadesProvider,
  isPropiedadesChallenge,
  parsePropiedadesDetail,
  parsePropiedadesSearch,
  propiedadesSourceIdFromUrl,
} from './providers/mx/propiedades';
export {
  PROPIEDADES_BASE_URL,
  PROPIEDADES_FIXTURE_DETAIL_HTML,
  PROPIEDADES_FIXTURE_SEARCH_HTML,
} from './providers/mx/propiedades/fixtures';

// Colombia (CO) — MercadoLibre housing-only / Metrocuadrado (shared Navent).
export {
  MercadolibreCoProvider,
  MERCADOLIBRE_CO_SITE,
  isMercadolibreCoChallenge,
  isMercadolibreCoHousingCategory,
  mercadolibreCoHousingSearchUrl,
  mercadolibreCoSourceIdFromUrl,
  parseMercadolibreCoDetail,
  parseMercadolibreCoItemJson,
  parseMercadolibreCoSearch,
  parseMercadolibreCoSearchJson,
} from './providers/co/mercadolibre';
export {
  MERCADOLIBRE_CO_BASE_URL,
  MERCADOLIBRE_CO_HOUSING_SLUGS,
  MERCADOLIBRE_CO_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_CO_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_CO_FIXTURE_SEARCH_HTML,
  MERCADOLIBRE_CO_FIXTURE_SEARCH_JSON,
} from './providers/co/mercadolibre/fixtures';
export {
  MetrocuadradoProvider,
  METROCUADRADO_SITE,
  isMetrocuadradoChallenge,
  metrocuadradoSourceIdFromUrl,
  parseMetrocuadradoDetail,
  parseMetrocuadradoPostingJson,
  parseMetrocuadradoSearch,
  parseMetrocuadradoSearchJson,
} from './providers/co/metrocuadrado';
export {
  METROCUADRADO_BASE_URL,
  METROCUADRADO_FIXTURE_DETAIL_HTML,
  METROCUADRADO_FIXTURE_SEARCH_HTML,
  METROCUADRADO_FIXTURE_SEARCH_JSON,
} from './providers/co/metrocuadrado/fixtures';

// Chile (CL) — MercadoLibre housing-only (arriendo segment).
export {
  MercadolibreClProvider,
  MERCADOLIBRE_CL_SITE,
  isMercadolibreClChallenge,
  isMercadolibreClHousingCategory,
  mercadolibreClHousingSearchUrl,
  mercadolibreClSourceIdFromUrl,
  parseMercadolibreClDetail,
  parseMercadolibreClItemJson,
  parseMercadolibreClSearch,
  parseMercadolibreClSearchJson,
} from './providers/cl/mercadolibre';
export {
  MERCADOLIBRE_CL_BASE_URL,
  MERCADOLIBRE_CL_HOUSING_SLUGS,
  MERCADOLIBRE_CL_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_CL_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_CL_FIXTURE_SEARCH_HTML,
  MERCADOLIBRE_CL_FIXTURE_SEARCH_JSON,
} from './providers/cl/mercadolibre/fixtures';

// Peru (PE) — MercadoLibre housing-only.
export {
  MercadolibrePeProvider,
  MERCADOLIBRE_PE_SITE,
  isMercadolibrePeChallenge,
  isMercadolibrePeHousingCategory,
  mercadolibrePeHousingSearchUrl,
  mercadolibrePeSourceIdFromUrl,
  parseMercadolibrePeDetail,
  parseMercadolibrePeItemJson,
  parseMercadolibrePeSearch,
  parseMercadolibrePeSearchJson,
} from './providers/pe/mercadolibre';
export {
  MERCADOLIBRE_PE_BASE_URL,
  MERCADOLIBRE_PE_HOUSING_SLUGS,
  MERCADOLIBRE_PE_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_PE_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_PE_FIXTURE_SEARCH_HTML,
  MERCADOLIBRE_PE_FIXTURE_SEARCH_JSON,
} from './providers/pe/mercadolibre/fixtures';

// Mexico — MercadoLibre housing-only (renta segment).
export {
  MercadolibreMxProvider,
  MERCADOLIBRE_MX_SITE,
  isMercadolibreMxChallenge,
  isMercadolibreMxHousingCategory,
  mercadolibreMxHousingSearchUrl,
  mercadolibreMxSourceIdFromUrl,
  parseMercadolibreMxDetail,
  parseMercadolibreMxItemJson,
  parseMercadolibreMxSearch,
  parseMercadolibreMxSearchJson,
} from './providers/mx/mercadolibre';
export {
  MERCADOLIBRE_MX_BASE_URL,
  MERCADOLIBRE_MX_HOUSING_SLUGS,
  MERCADOLIBRE_MX_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_MX_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_MX_FIXTURE_SEARCH_HTML,
  MERCADOLIBRE_MX_FIXTURE_SEARCH_JSON,
} from './providers/mx/mercadolibre/fixtures';

// Portugal — Idealista.pt (georeach AJAX + contact).
export {
  IdealistaPtProvider,
  isIdealistaPtChallenge,
  idealistaPtSourceIdFromUrl,
} from './providers/pt/idealistaPt';
export {
  parseIdealistaPtDetail,
  parseIdealistaPtSearch,
  type IdealistaPtRaw,
} from './providers/pt/idealistaPt/parse';
export {
  parseIdealistaPtGeoreach,
  idealistaPtGeoreachUrl,
  idealistaPtWarmSearchUrl,
  isIdealistaPtGeoreachChallenge,
} from './providers/pt/idealistaPt/georeach';
export {
  IDEALISTA_PT_BASE_URL,
  IDEALISTA_PT_FIXTURE_DETAIL_HTML,
  IDEALISTA_PT_FIXTURE_SEARCH_HTML,
  IDEALISTA_PT_FIXTURE_GEOREACH_JSON,
  IDEALISTA_PT_FIXTURE_GEOREACH_CHALLENGE,
  IDEALISTA_PT_FIXTURE_CONTACT_JSON,
} from './providers/pt/idealistaPt/fixtures';
export {
  parseIdealistaPtContactInfo,
  parseIdealistaPtContactPhones,
} from './providers/pt/idealistaPt/contact';

// Canada (CA) — Realtor.ca (api2 JSON + Imperva session).
export {
  RealtorCaProvider,
  isRealtorCaChallenge,
  parseRealtorCaDetail,
  parseRealtorCaSearch,
  realtorCaSourceIdFromUrl,
} from './providers/ca/realtorCa';
export {
  REALTOR_CA_BASE_URL,
  REALTOR_CA_FIXTURE_DETAIL_JSON,
  REALTOR_CA_FIXTURE_SEARCH_JSON,
} from './providers/ca/realtorCa/fixtures';

// Australia (AU) — realestate.com.au (ArgonautExchange JSON).
export {
  RealestateComAuProvider,
  isRealestateComAuChallenge,
  parseRealestateComAuDetail,
  parseRealestateComAuSearch,
  realestateComAuSourceIdFromUrl,
} from './providers/au/realestateCom';
export {
  REALESTATE_COM_AU_BASE_URL,
  REALESTATE_COM_AU_FIXTURE_DETAIL_HTML,
  REALESTATE_COM_AU_FIXTURE_SEARCH_HTML,
} from './providers/au/realestateCom/fixtures';

// UAE (AE) — Bayut (__NEXT_DATA__ JSON).
export {
  BayutProvider,
  isBayutChallenge,
  parseBayutDetail,
  parseBayutSearch,
  bayutSourceIdFromUrl,
} from './providers/ae/bayut';
export {
  BAYUT_BASE_URL,
  BAYUT_FIXTURE_DETAIL_HTML,
  BAYUT_FIXTURE_SEARCH_HTML,
} from './providers/ae/bayut/fixtures';

// Ireland (IE) — Daft.ie __NEXT_DATA__ JSON.
export {
  DaftProvider,
  isDaftChallenge,
  parseDaftDetail,
  parseDaftSearch,
  daftSearchUrl,
  daftSourceIdFromUrl,
} from './providers/ie/daft';
export {
  DAFT_BASE_URL,
  DAFT_FIXTURE_DETAIL_HTML,
  DAFT_FIXTURE_SEARCH_HTML,
} from './providers/ie/daft/fixtures';

// Belgium (BE) — Immoweb search-results + classified JSON.
export {
  ImmowebProvider,
  isImmowebChallenge,
  parseImmowebDetail,
  parseImmowebSearch,
  immowebSearchUrl,
  immowebDetailUrl,
  immowebSourceIdFromUrl,
} from './providers/be/immoweb';
export {
  IMMOWEB_BASE_URL,
  IMMOWEB_FIXTURE_DETAIL_JSON,
  IMMOWEB_FIXTURE_SEARCH_JSON,
} from './providers/be/immoweb/fixtures';

// Poland (PL) — Otodom __NEXT_DATA__ (OLX vertical).
export {
  OtodomProvider,
  isOtodomChallenge,
  parseOtodomDetail,
  parseOtodomSearch,
  otodomSearchUrl,
  otodomSourceIdFromUrl,
} from './providers/pl/otodom';
export {
  OTODOM_BASE_URL,
  OTODOM_FIXTURE_DETAIL_HTML,
  OTODOM_FIXTURE_DETAIL_UNIFIED_HTML,
  OTODOM_FIXTURE_SEARCH_HTML,
} from './providers/pl/otodom/fixtures';

// Netherlands (NL) — Funda mobile JSON API (Akamai — proxy required).
export {
  FundaProvider,
  isFundaChallenge,
  parseFundaDetail,
  parseFundaSearch,
  fundaSearchBody,
  fundaDetailUrl,
  fundaSourceIdFromUrl,
  FUNDA_JSON_HEADERS,
} from './providers/nl/funda';
export {
  FUNDA_BASE_URL,
  FUNDA_FIXTURE_DETAIL_JSON,
  FUNDA_FIXTURE_SEARCH_JSON,
} from './providers/nl/funda/fixtures';

import type { ProviderId } from '@homiio/shared-types';
import { ProviderRegistry } from './registry';
import type { ListingProvider } from './types';
import { citiesOptionsFromEnv } from './cities';
import { FixtureProvider } from './providers/fixture';
import { HabitacliaProvider } from './providers/habitaclia';
import { habitacliaCitiesOptionsFromEnv } from './providers/habitaclia/cities';
import { BluegroundProvider } from './providers/blueground';
import { IdealistaProvider } from './providers/idealista';
import { idealistaCitiesOptionsFromEnv } from './providers/idealista/cities';
import { FotocasaProvider, fotocasaCitiesOptionsFromEnv } from './providers/fotocasa';
import { PisosProvider } from './providers/pisos';
import { pisosCitiesOptionsFromEnv } from './providers/pisos/cities';
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
import { ZonapropProvider } from './providers/ar/zonaprop';
import { ArgenpropProvider } from './providers/ar/argenprop';
import { MercadolibreArProvider } from './providers/ar/mercadolibre';
import { ProperatiProvider } from './providers/ar/properati';

import { StoriaProvider } from './providers/ro/storia';
import { ImobiliareRoProvider } from './providers/ro/imobiliare';
import { OlxRoProvider } from './providers/ro/olx';
import { PlusvaliaProvider } from './providers/ec/plusvalia';
import { MercadolibreEcProvider } from './providers/ec/mercadolibre';
import { ProperatiEcProvider } from './providers/ec/properati';
import { BieniciProvider } from './providers/fr/bienici';
import { LeboncoinProvider } from './providers/fr/leboncoin';
import { SelogerProvider } from './providers/fr/seloger';
import { Inmuebles24Provider } from './providers/mx/inmuebles24';
import { LamudiProvider } from './providers/mx/lamudi';
import { VivanunciosProvider } from './providers/mx/vivanuncios';
import { PropiedadesProvider } from './providers/mx/propiedades';
import { MercadolibreCoProvider } from './providers/co/mercadolibre';
import { MetrocuadradoProvider } from './providers/co/metrocuadrado';
import { MercadolibreClProvider } from './providers/cl/mercadolibre';
import { MercadolibrePeProvider } from './providers/pe/mercadolibre';
import { MercadolibreMxProvider } from './providers/mx/mercadolibre';
import { IdealistaPtProvider } from './providers/pt/idealistaPt';
import { RealtorCaProvider } from './providers/ca/realtorCa';
import { RealestateComAuProvider } from './providers/au/realestateCom';
import { BayutProvider } from './providers/ae/bayut';
import { DaftProvider } from './providers/ie/daft';
import { ImmowebProvider } from './providers/be/immoweb';
import { OtodomProvider } from './providers/pl/otodom';
import { FundaProvider } from './providers/nl/funda';

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
  const esOptions = citiesOptionsFromEnv('ES');
  const gbOptions = citiesOptionsFromEnv('GB');
  const usOptions = citiesOptionsFromEnv('US');
  const itOptions = citiesOptionsFromEnv('IT');
  const deOptions = citiesOptionsFromEnv('DE');
  const arOptions = citiesOptionsFromEnv('AR');
  const roOptions = citiesOptionsFromEnv('RO');
  const ecOptions = citiesOptionsFromEnv('EC');
  const frOptions = citiesOptionsFromEnv('FR');
  const mxOptions = citiesOptionsFromEnv('MX');
  const coOptions = citiesOptionsFromEnv('CO');
  const clOptions = citiesOptionsFromEnv('CL');
  const peOptions = citiesOptionsFromEnv('PE');
  const ptOptions = citiesOptionsFromEnv('PT');
  const caOptions = citiesOptionsFromEnv('CA');
  const auOptions = citiesOptionsFromEnv('AU');
  const aeOptions = citiesOptionsFromEnv('AE');
  const ieOptions = citiesOptionsFromEnv('IE');
  const beOptions = citiesOptionsFromEnv('BE');
  const plOptions = citiesOptionsFromEnv('PL');
  const nlOptions = citiesOptionsFromEnv('NL');
  const flaggedProviders: ListingProvider[] = [
    new HabitacliaProvider(habitacliaCitiesOptionsFromEnv()),
    new BluegroundProvider(),
    new IdealistaProvider(idealistaCitiesOptionsFromEnv()),
    new FotocasaProvider(fotocasaCitiesOptionsFromEnv()),
    new PisosProvider(pisosCitiesOptionsFromEnv()),
    new MilanunciosProvider(esOptions),
    new YaencontreProvider(esOptions),
    new IndomioProvider(esOptions),
    new ApartmentsComProvider(usOptions),
    new ZillowProvider(usOptions),
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
    new ZonapropProvider(arOptions),
    new ArgenpropProvider(arOptions),
    new MercadolibreArProvider(arOptions),
    new ProperatiProvider(arOptions),
    new KleinanzeigenProvider(deOptions),
    new StoriaProvider(roOptions),
    new ImobiliareRoProvider(roOptions),
    new OlxRoProvider(roOptions),
    new PlusvaliaProvider(ecOptions),
    new MercadolibreEcProvider(ecOptions),
    new ProperatiEcProvider(ecOptions),
    new BieniciProvider(frOptions),
    new LeboncoinProvider(frOptions),
    new SelogerProvider(frOptions),
    new Inmuebles24Provider(mxOptions),
    new LamudiProvider(mxOptions),
    new VivanunciosProvider(mxOptions),
    new PropiedadesProvider(mxOptions),
    new MercadolibreMxProvider(mxOptions),
    new MercadolibreCoProvider(coOptions),
    new MetrocuadradoProvider(coOptions),
    new MercadolibreClProvider(clOptions),
    new MercadolibrePeProvider(peOptions),
    new IdealistaPtProvider(ptOptions),
    new RealtorCaProvider(caOptions),
    new RealestateComAuProvider(auOptions),
    new BayutProvider(aeOptions),
    new DaftProvider(ieOptions),
    new ImmowebProvider(beOptions),
    new OtodomProvider(plOptions),
    new FundaProvider(nlOptions),
  ];
  for (const provider of flaggedProviders) {
    if (providerEnabled(provider.id)) {
      registry.register(provider);
    }
  }
  return registry;
}
