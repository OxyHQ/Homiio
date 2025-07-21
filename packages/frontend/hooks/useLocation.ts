import { useCallback } from 'react';
import { useLocationStore, useLocationSelectors } from '@/store/locationStore';

export const useLocationSearch = () => {
  const { searchResults, isLoading, error } = useLocationSelectors();
  const { setSearchResults, setLoading, setError, clearSearchResults, addSearchHistory } = useLocationStore();

  const search = useCallback(async (query: string) => {
    if (query && query.trim().length > 0) {
      try {
        setLoading(true);
        setError(null);
        
        const params = new URLSearchParams({
          format: 'json',
          q: query.trim(),
          limit: '10'
        });

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?${params.toString()}`
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to fetch location suggestions`);
        }

        const data = await response.json();
        setSearchResults(data);
        addSearchHistory(query, data);
      } catch (error: any) {
        setError(error.message || 'Failed to search location');
      } finally {
        setLoading(false);
      }
    }
  }, [setSearchResults, setLoading, setError, addSearchHistory]);

  const clearResults = useCallback(() => {
    clearSearchResults();
  }, [clearSearchResults]);

  return {
    results: searchResults,
    loading: isLoading,
    error,
    search,
    clearResults,
  };
};

export const useReverseGeocode = () => {
  const { currentLocation, isLoading, error } = useLocationSelectors();
  const { setCurrentLocation, setLoading, setError } = useLocationStore();

  const reverseGeocodeLocation = useCallback(async (lat: number, lng: number) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to reverse geocode`);
      }

      const data = await response.json();
      
      const locationData = {
        latitude: lat,
        longitude: lng,
        address: data.display_name || 'Unknown location',
        city: data.address?.city || data.address?.town || data.address?.village || '',
        state: data.address?.state || '',
        country: data.address?.country || '',
        zipCode: data.address?.postcode || ''
      };
      
      setCurrentLocation(locationData);
    } catch (error: any) {
      setError(error.message || 'Failed to reverse geocode');
    } finally {
      setLoading(false);
    }
  }, [setCurrentLocation, setLoading, setError]);

  const clearResult = useCallback(() => {
    setCurrentLocation(null);
  }, [setCurrentLocation]);

  return {
    result: currentLocation,
    loading: isLoading,
    error,
    coordinates: currentLocation ? { lat: currentLocation.latitude, lng: currentLocation.longitude } : null,
    reverseGeocode: reverseGeocodeLocation,
    clearResult,
  };
};

export const useLocation = () => {
  const { searchResults, currentLocation, isLoading, error } = useLocationSelectors();
  const { 
    setSearchResults, 
    setCurrentLocation, 
    setLoading, 
    setError, 
    clearSearchResults,
    addSearchHistory
  } = useLocationStore();

  const search = useCallback(async (query: string) => {
    if (query && query.trim().length > 0) {
      try {
        setLoading(true);
        setError(null);
        
        const params = new URLSearchParams({
          format: 'json',
          q: query.trim(),
          limit: '10'
        });

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?${params.toString()}`
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to fetch location suggestions`);
        }

        const data = await response.json();
        setSearchResults(data);
        addSearchHistory(query, data);
      } catch (error: any) {
        setError(error.message || 'Failed to search location');
      } finally {
        setLoading(false);
      }
    }
  }, [setSearchResults, setLoading, setError, addSearchHistory]);

  const reverseGeocodeLocation = useCallback(async (lat: number, lng: number) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to reverse geocode`);
      }

      const data = await response.json();
      
      const locationData = {
        latitude: lat,
        longitude: lng,
        address: data.display_name || 'Unknown location',
        city: data.address?.city || data.address?.town || data.address?.village || '',
        state: data.address?.state || '',
        country: data.address?.country || '',
        zipCode: data.address?.postcode || ''
      };
      
      setCurrentLocation(locationData);
    } catch (error: any) {
      setError(error.message || 'Failed to reverse geocode');
    } finally {
      setLoading(false);
    }
  }, [setCurrentLocation, setLoading, setError]);

  const clearAll = useCallback(() => {
    clearSearchResults();
    setCurrentLocation(null);
  }, [clearSearchResults, setCurrentLocation]);

  const clearSearch = useCallback(() => {
    clearSearchResults();
  }, [clearSearchResults]);

  const clearReverse = useCallback(() => {
    setCurrentLocation(null);
  }, [setCurrentLocation]);

  return {
    searchResults,
    searchLoading: isLoading,
    searchError: error,
    reverseResult: currentLocation,
    reverseLoading: isLoading,
    reverseError: error,
    reverseCoordinates: currentLocation ? { lat: currentLocation.latitude, lng: currentLocation.longitude } : null,
    search,
    reverseGeocode: reverseGeocodeLocation,
    clearAll,
    clearSearch,
    clearReverse,
  };
}; 