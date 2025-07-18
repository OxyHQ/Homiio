// Property Redux Hooks
export {
  useProperties,
  useProperty,
  usePropertyStats,
  usePropertyEnergyStats,
  useSearchProperties,
  useCreateProperty,
  useUpdateProperty,
  useDeleteProperty,
  useUserProperties,
} from './usePropertyQueries';

// Property List Redux Hooks
export {
  useEcoProperties,
  useCityProperties,
  useTypeProperties,
  useClearAllPropertyLists,
} from './usePropertyListRedux';

// Location Redux Hooks
export {
  useLocationSearch,
  useLocation,
} from './useLocationRedux';

// Profile Zustand Hooks
export {
  useProfileZustand,
} from './useProfileZustand';

// Lease Redux Hooks
export {
  useUserLeases,
  useHasRentalProperties,
} from './useLeaseQueries';

// Roommate Redux Hooks
export {
  useRoommateProfiles,
  useHasRoommateMatching,
  useToggleRoommateMatching,
  useSendRoommateRequest,
} from './useRoommateQueries';

// Room Redux Hooks
export {
  useRooms,
  useRoom,
  useRoomStats,
  useRoomEnergyStats,
  useSearchRooms,
  useCreateRoom,
  useUpdateRoom,
  useDeleteRoom,
  useAssignTenant,
  useUnassignTenant,
} from './useRoomRedux';

// Neighborhood Redux Hooks
export {
  useNeighborhood,
} from './useNeighborhood';

// Address Search Hooks
export {
  useAddressSearch,
  useDebouncedAddressSearch,
  useReverseGeocode,
  type AddressSuggestion,
  type AddressSearchOptions,
  type UseAddressSearchReturn,
} from './useAddressSearch'; 