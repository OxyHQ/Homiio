// Core hooks
export { useLocationSearch } from './useLocation';
export { useEcoProperties } from './usePropertyList';
export { useSavedProperties } from './useSavedProperties';
export { useProfile } from './useProfile';

// Property hooks
export { useProperties, useProperty, usePropertyStats } from './usePropertyQueries';

// Profile hooks
export { useProfileRedux, useActiveProfile } from './useProfileQueries';

// Favorites hooks
export { useFavorites } from './useFavorites';

// Utility hooks
export { useDebounce } from './useDebounce';
export { useDocumentTitle } from './useDocumentTitle';
export { useSEO } from './useDocumentTitle';

// Address Search hooks
export {
  useAddressSearch,
  useDebouncedAddressSearch,
  useReverseGeocode,
  type AddressSuggestion,
  type AddressSearchOptions,
  type UseAddressSearchReturn,
} from './useAddressSearch';
