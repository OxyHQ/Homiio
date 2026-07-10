// Core hooks
export { useLocationSearch } from './useLocation';
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

// Address Search hooks
export {
  useAddressSearch,
  useDebouncedAddressSearch,
  useReverseGeocode,
  type AddressSuggestion,
  type AddressSearchOptions,
  type UseAddressSearchReturn,
} from './useAddressSearch';
