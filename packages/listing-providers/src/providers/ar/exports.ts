/**
 * Argentina market barrel — imported by package index.
 * Keeps AR registration resilient while other markets churn index.ts.
 */

export {
  ZonapropProvider,
  isZonapropChallenge,
  zonapropSourceIdFromUrl,
  parseZonapropDetail,
  parseZonapropSearch,
  parseZonapropSearchJson,
  ZONAPROP_SITE,
} from './zonaprop';
export {
  ZONAPROP_BASE_URL,
  ZONAPROP_FIXTURE_DETAIL_HTML,
  ZONAPROP_FIXTURE_SEARCH_HTML,
  ZONAPROP_FIXTURE_SEARCH_JSON,
} from './zonaprop/fixtures';

export {
  ArgenpropProvider,
  isArgenpropChallenge,
  argenpropSourceIdFromUrl,
  parseArgenpropDetail,
  parseArgenpropSearch,
  parseArgenpropSearchJson,
  ARGENPROP_SITE,
} from './argenprop';
export {
  ARGENPROP_BASE_URL,
  ARGENPROP_FIXTURE_DETAIL_HTML,
  ARGENPROP_FIXTURE_SEARCH_HTML,
  ARGENPROP_FIXTURE_SEARCH_JSON,
} from './argenprop/fixtures';

export {
  MercadolibreArProvider,
  isMercadolibreArChallenge,
  isMercadolibreArHousingCategory,
  mercadolibreArHousingSearchUrl,
  mercadolibreArSourceIdFromUrl,
  parseMercadolibreArDetail,
  parseMercadolibreArSearch,
  parseMercadolibreArSearchJson,
  MERCADOLIBRE_AR_SITE,
} from './mercadolibre';
export {
  MERCADOLIBRE_AR_BASE_URL,
  MERCADOLIBRE_AR_HOUSING_SLUGS,
  MERCADOLIBRE_AR_FIXTURE_DETAIL_HTML,
  MERCADOLIBRE_AR_FIXTURE_NON_HOUSING_JSON,
  MERCADOLIBRE_AR_FIXTURE_SEARCH_HTML,
  MERCADOLIBRE_AR_FIXTURE_SEARCH_JSON,
} from './mercadolibre/fixtures';

export {
  ProperatiProvider,
  isProperatiChallenge,
  parseProperatiDetail,
  parseProperatiSearch,
  properatiSourceIdFromUrl,
} from './properati';
export {
  PROPERATI_BASE_URL,
  PROPERATI_FIXTURE_DETAIL_HTML,
  PROPERATI_FIXTURE_SEARCH_HTML,
} from './properati/fixtures';
