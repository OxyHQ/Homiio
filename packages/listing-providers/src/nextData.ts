/**
 * Shared Next.js / page-model extraction — implementation in {@link ./parse/nextData}.
 */
export {
  parseNextData,
  extractNextData,
  parsePreloadedState,
  nextDataPageProps,
  parseNextDataPageProps,
  findNextDataArray,
  findNextDataRecord,
  readNestedPrice,
  readNestedCity,
  collectNestedImages,
  eurListingFromNextDataCandidate,
  extractEurListingFromNextData,
} from './parse/nextData';
