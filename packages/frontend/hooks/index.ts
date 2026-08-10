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

export { homeFeedQueryKeys, useUserCoordinates, type UserCoordinates } from './useHomeFeed';

// Where the app is looking, and what Home shows there (#353).
export {
  DEVICE_SCOPE_RADIUS_METERS,
  deviceAreaKey,
  useLocationScope,
  type LocationScope,
} from './useLocationScope';
export {
  resolveLocationScope,
  type DevicePositionState,
  type LocationScopeInputs,
  type LocationScopeSource,
  type LocationScopeState,
} from './locationScopeLadder';
export {
  homeSectionsQueryKey,
  resolveFreshness,
  useHomeSections,
  type HomeDataFreshness,
  type HomeSectionsResult,
} from './useHomeSections';

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
