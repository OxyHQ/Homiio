// Core hooks
export { useLocationSearch } from './useLocation';
export { useEcoProperties } from './usePropertyList';
export { useSavedProperties } from './useSavedProperties';
export { useProfile } from './useProfile';

// Property hooks
export { useProperties, useProperty, usePropertyStats, useSearchProperties } from './usePropertyQueries';

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
