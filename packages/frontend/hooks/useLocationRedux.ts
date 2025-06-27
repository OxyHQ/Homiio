import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import {
  searchLocation,
  reverseGeocode,
  clearSearchResults,
  clearReverseGeocode,
  setSearchQuery,
  clearAllLocationData,
} from '@/store/reducers/locationReducer';
import type { LocationResult, ReverseLocationResult } from '@/store/reducers/locationReducer';

// Selectors
export const useLocationSelectors = () => {
  const searchResults = useSelector((state: RootState) => state.location.searchResults);
  const reverseGeocodeData = useSelector((state: RootState) => state.location.reverseGeocode);

  return {
    searchResults,
    reverseGeocodeData,
  };
};

// Location Search Hook
export const useLocationSearch = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { searchResults } = useLocationSelectors();

  const search = useCallback((query: string) => {
    if (query && query.trim().length > 0) {
      dispatch(searchLocation(query));
    }
  }, [dispatch]);

  const clearResults = useCallback(() => {
    dispatch(clearSearchResults());
  }, [dispatch]);

  const setQuery = useCallback((query: string) => {
    dispatch(setSearchQuery(query));
  }, [dispatch]);

  return {
    results: searchResults.results,
    loading: searchResults.loading,
    error: searchResults.error,
    query: searchResults.query,
    search,
    clearResults,
    setQuery,
  };
};

// Reverse Geocoding Hook
export const useReverseGeocode = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { reverseGeocodeData } = useLocationSelectors();

  const reverseGeocodeLocation = useCallback((lat: number, lng: number) => {
    dispatch(reverseGeocode({ lat, lng }));
  }, [dispatch]);

  const clearResult = useCallback(() => {
    dispatch(clearReverseGeocode());
  }, [dispatch]);

  return {
    result: reverseGeocodeData.result,
    loading: reverseGeocodeData.loading,
    error: reverseGeocodeData.error,
    coordinates: reverseGeocodeData.coordinates,
    reverseGeocode: reverseGeocodeLocation,
    clearResult,
  };
};

// Combined Location Hook
export const useLocation = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { searchResults, reverseGeocodeData } = useLocationSelectors();

  const search = useCallback((query: string) => {
    if (query && query.trim().length > 0) {
      dispatch(searchLocation(query));
    }
  }, [dispatch]);

  const reverseGeocodeLocation = useCallback((lat: number, lng: number) => {
    dispatch(reverseGeocode({ lat, lng }));
  }, [dispatch]);

  const clearAll = useCallback(() => {
    dispatch(clearAllLocationData());
  }, [dispatch]);

  const clearSearch = useCallback(() => {
    dispatch(clearSearchResults());
  }, [dispatch]);

  const clearReverse = useCallback(() => {
    dispatch(clearReverseGeocode());
  }, [dispatch]);

  return {
    // Search functionality
    searchResults: searchResults.results,
    searchLoading: searchResults.loading,
    searchError: searchResults.error,
    searchQuery: searchResults.query,
    
    // Reverse geocoding functionality
    reverseResult: reverseGeocodeData.result,
    reverseLoading: reverseGeocodeData.loading,
    reverseError: reverseGeocodeData.error,
    reverseCoordinates: reverseGeocodeData.coordinates,
    
    // Actions
    search,
    reverseGeocode: reverseGeocodeLocation,
    clearAll,
    clearSearch,
    clearReverse,
  };
}; 