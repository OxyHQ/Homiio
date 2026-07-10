/**
 * Shared discover-city lists from `LISTING_<MARKET>_CITIES` env vars.
 *
 * Providers and {@link createDefaultRegistry} must call {@link citiesFromEnv} /
 * {@link citiesOptionsFromEnv} — never re-copy the split/trim snippet.
 */

export {
  citiesFromEnv,
  citiesOptionsFromEnv,
  type ListingMarket,
} from './parse/cities';
