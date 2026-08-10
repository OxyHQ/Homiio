// Core hooks
export { useEcoProperties } from './usePropertyList';
export { useSavedProperties } from './useSavedProperties';
export { useProfileActions } from './useProfile';

// Property hooks
export {
  useProperties,
  useProperty,
  usePropertyStats,
  useAreaInsights,
  useNearbyServices,
  useSearchProperties,
} from './usePropertyQueries';

export {
  HOME_FEED_LIMIT,
  buildHomeFeedFilters,
  homeFeedQueryKeys,
  isNearYouBlocked,
  useHomeFeedProperties,
  useUserCoordinates,
  type UserCoordinates,
} from './useHomeFeed';

// Exchange hooks (home swap / free hosting)
export {
  useMyExchangeRequests,
  useExchangeRequest,
  useExchangeRequestReviews,
  useProfileExchangeReviews,
  useCreateExchangeRequest,
  useUpdateExchangeStatus,
  useCreateExchangeReview,
  exchangeKeys,
} from './useExchangeQueries';

// Profile hooks
export { useProfileRedux, useActiveProfile } from './useProfileQueries';

// Utility hooks
export { useDebounce } from './useDebounce';

// Place autocomplete, through Homiio's geo gateway (never a geocoder directly).
export {
  useAddressSearch,
  useDebouncedAddressSearch,
  type AddressSearchOptions,
  type AddressSearchState,
  type UseAddressSearchReturn,
} from './useAddressSearch';
