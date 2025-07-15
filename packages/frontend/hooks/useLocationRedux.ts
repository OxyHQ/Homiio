import { useCallback } from 'react';
import { useLocationStore, useLocationSelectors } from '@/store/locationStore';

// Location Search Hook
export const useLocationSearch = () => {
  const { searchResults, searchQuery, isLoading, error } = useLocationSelectors();
  const { setSearchResults, setSearchQuery, setLoading, setError, clearSearchResults } = useLocationStore();

  const search = useCallback(async (query: string) => {
    if (query && query.trim().length > 0) {
      try {
        setLoading(true);
        setError(null);
        setSearchQuery(query);
        
        // Import the API function
        const { locationApi } = await import('@/utils/api');
        const response = await locationApi.searchLocation(query);
        
        setSearchResults(response.data || []);
      } catch (error: any) {
        setError(error.message || 'Failed to search location');
      } finally {
        setLoading(false);
      }
    }
  }, [setSearchResults, setSearchQuery, setLoading, setError]);

  const clearResults = useCallback(() => {
    clearSearchResults();
  }, [clearSearchResults]);

  const setQuery = useCallback((query: string) => {
    setSearchQuery(query);
  }, [setSearchQuery]);

  return {
    results: searchResults,
    loading: isLoading,
    error,
    query: searchQuery,
    search,
    clearResults,
    setQuery,
  };
};

// Reverse Geocoding Hook
export const useReverseGeocode = () => {
  const { reverseGeocodeData, coordinates, isLoading, error } = useLocationSelectors();
  const { setReverseGeocodeData, setCoordinates, setLoading, setError, clearReverseGeocode } = useLocationStore();

  const reverseGeocodeLocation = useCallback(async (lat: number, lng: number) => {
    try {
      setLoading(true);
      setError(null);
      setCoordinates({ lat, lng });
      
      // Import the API function
      const { locationApi } = await import('@/utils/api');
      const response = await locationApi.reverseGeocode(lat, lng);
      
      setReverseGeocodeData(response.data);
    } catch (error: any) {
      setError(error.message || 'Failed to reverse geocode');
    } finally {
      setLoading(false);
    }
  }, [setReverseGeocodeData, setCoordinates, setLoading, setError]);

  const clearResult = useCallback(() => {
    clearReverseGeocode();
  }, [clearReverseGeocode]);

  return {
    result: reverseGeocodeData,
    loading: isLoading,
    error,
    coordinates,
    reverseGeocode: reverseGeocodeLocation,
    clearResult,
  };
};

// Combined Location Hook
export const useLocation = () => {
  const { searchResults, searchQuery, reverseGeocodeData, coordinates, isLoading, error } = useLocationSelectors();
  const { 
    setSearchResults, 
    setSearchQuery, 
    setReverseGeocodeData, 
    setCoordinates, 
    setLoading, 
    setError, 
    clearSearchResults, 
    clearReverseGeocode,
    clearAllLocationData 
  } = useLocationStore();

  const search = useCallback(async (query: string) => {
    if (query && query.trim().length > 0) {
      try {
        setLoading(true);
        setError(null);
        setSearchQuery(query);
        
        // Import the API function
        const { locationApi } = await import('@/utils/api');
        const response = await locationApi.searchLocation(query);
        
        setSearchResults(response.data || []);
      } catch (error: any) {
        setError(error.message || 'Failed to search location');
      } finally {
        setLoading(false);
      }
    }
  }, [setSearchResults, setSearchQuery, setLoading, setError]);

  const reverseGeocodeLocation = useCallback(async (lat: number, lng: number) => {
    try {
      setLoading(true);
      setError(null);
      setCoordinates({ lat, lng });
      
      // Import the API function
      const { locationApi } = await import('@/utils/api');
      const response = await locationApi.reverseGeocode(lat, lng);
      
      setReverseGeocodeData(response.data);
    } catch (error: any) {
      setError(error.message || 'Failed to reverse geocode');
    } finally {
      setLoading(false);
    }
  }, [setReverseGeocodeData, setCoordinates, setLoading, setError]);

  const clearAll = useCallback(() => {
    clearAllLocationData();
  }, [clearAllLocationData]);

  const clearSearch = useCallback(() => {
    clearSearchResults();
  }, [clearSearchResults]);

  const clearReverse = useCallback(() => {
    clearReverseGeocode();
  }, [clearReverseGeocode]);

  return {
    // Search functionality
    searchResults,
    searchLoading: isLoading,
    searchError: error,
    searchQuery,
    
    // Reverse geocoding functionality
    reverseResult: reverseGeocodeData,
    reverseLoading: isLoading,
    reverseError: error,
    reverseCoordinates: coordinates,
    
    // Actions
    search,
    reverseGeocode: reverseGeocodeLocation,
    clearAll,
    clearSearch,
    clearReverse,
  };
}; 