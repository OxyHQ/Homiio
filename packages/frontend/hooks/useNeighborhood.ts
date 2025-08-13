import { useEffect, useCallback } from 'react';
import { useNeighborhoodStore } from '@/store/neighborhoodStore';
import { useOxy } from '@oxyhq/services';
import type { NeighborhoodFilters } from '@/services/neighborhoodService';

export function useNeighborhood() {
  const {
    currentNeighborhood,
    popularNeighborhoods,
    searchResults,
    isLoading,
    error,
    setCurrentNeighborhood,
    setPopularNeighborhoods,
    setSearchResults,
    setLoading,
    setError,
    clearCurrentNeighborhood,
    clearSearchResults,
    clearError,
  } = useNeighborhoodStore();
  const { oxyServices, activeSessionId } = useOxy();

  const isAuthenticated = !!(oxyServices && activeSessionId);

  // Fetch neighborhood by location
  const fetchByLocation = useCallback(
    async (latitude: number, longitude: number) => {
      if (!isAuthenticated) {
        console.log('useNeighborhood: User not authenticated, skipping API call');
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Import the API function
        const { neighborhoodApi } = await import('@/utils/api');
        const response = await neighborhoodApi.getNeighborhoodByLocation(
          latitude,
          longitude,
          oxyServices,
          activeSessionId,
        );

        setCurrentNeighborhood(response.data);
      } catch (error: any) {
        console.error('useNeighborhood: Failed to fetch neighborhood by location:', error);
        setError(error.message || 'Failed to fetch neighborhood by location');
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, isAuthenticated, setCurrentNeighborhood, setLoading, setError],
  );

  // Fetch neighborhood by name
  const fetchByName = useCallback(
    async (name: string, city?: string, state?: string) => {
      if (!isAuthenticated) {
        console.log('useNeighborhood: User not authenticated, skipping API call');
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Import the API function
        const { neighborhoodApi } = await import('@/utils/api');
        const response = await neighborhoodApi.getNeighborhoodByName(
          name,
          city,
          state,
          oxyServices,
          activeSessionId,
        );

        setCurrentNeighborhood(response.data);
      } catch (error: any) {
        console.error('useNeighborhood: Failed to fetch neighborhood by name:', error);
        setError(error.message || 'Failed to fetch neighborhood by name');
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, isAuthenticated, setCurrentNeighborhood, setLoading, setError],
  );

  // Fetch neighborhood by property
  const fetchByProperty = useCallback(
    async (propertyId: string) => {
      if (!isAuthenticated) {
        console.log('useNeighborhood: User not authenticated, skipping API call');
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Import the API function
        const { neighborhoodApi } = await import('@/utils/api');
        const response = await neighborhoodApi.getNeighborhoodByProperty(
          propertyId,
          oxyServices,
          activeSessionId,
        );

        setCurrentNeighborhood(response.data);
      } catch (error: any) {
        console.error('useNeighborhood: Failed to fetch neighborhood by property:', error);
        setError(error.message || 'Failed to fetch neighborhood by property');
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, isAuthenticated, setCurrentNeighborhood, setLoading, setError],
  );

  // Search neighborhoods
  const search = useCallback(
    async (filters: NeighborhoodFilters) => {
      if (!isAuthenticated) {
        console.log('useNeighborhood: User not authenticated, skipping API call');
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Import the API function
        const { neighborhoodApi } = await import('@/utils/api');
        const response = await neighborhoodApi.searchNeighborhoods(
          filters,
          oxyServices,
          activeSessionId,
        );

        setSearchResults(response.data || []);
      } catch (error: any) {
        console.error('useNeighborhood: Failed to search neighborhoods:', error);
        setError(error.message || 'Failed to search neighborhoods');
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, isAuthenticated, setSearchResults, setLoading, setError],
  );

  // Fetch popular neighborhoods
  const fetchPopular = useCallback(
    async (city: string, state?: string, limit?: number) => {
      if (!isAuthenticated) {
        console.log('useNeighborhood: User not authenticated, skipping API call');
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Import the API function
        const { neighborhoodApi } = await import('@/utils/api');
        const response = await neighborhoodApi.getPopularNeighborhoods(
          city,
          state,
          limit,
          oxyServices,
          activeSessionId,
        );

        setPopularNeighborhoods(response.data || []);
      } catch (error: any) {
        console.error('useNeighborhood: Failed to fetch popular neighborhoods:', error);
        setError(error.message || 'Failed to fetch popular neighborhoods');
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, isAuthenticated, setPopularNeighborhoods, setLoading, setError],
  );

  // Manual actions
  const setCurrent = useCallback(
    (neighborhood: any) => {
      setCurrentNeighborhood(neighborhood);
    },
    [setCurrentNeighborhood],
  );

  const clearCurrent = useCallback(() => {
    clearCurrentNeighborhood();
  }, [clearCurrentNeighborhood]);

  const clearSearch = useCallback(() => {
    clearSearchResults();
  }, [clearSearchResults]);

  const setErrorState = useCallback(
    (error: string | null) => {
      setError(error);
    },
    [setError],
  );

  const clearErrorState = useCallback(() => {
    clearError();
  }, [clearError]);

  const reset = useCallback(() => {
    clearCurrentNeighborhood();
    clearSearchResults();
    clearError();
  }, [clearCurrentNeighborhood, clearSearchResults, clearError]);

  // Check if data is stale (older than 5 minutes)
  const isDataStale = useCallback(() => {
    // Not implemented in Zustand store yet
    return false;
  }, []);

  return {
    // State
    currentNeighborhood,
    popularNeighborhoods,
    searchResults,
    isLoading,
    isSearching: isLoading, // Not implemented in Zustand store yet
    error,
    lastFetched: null, // Not implemented in Zustand store yet
    isAuthenticated,
    isDataStale,

    // Actions
    fetchByLocation,
    fetchByName,
    fetchByProperty,
    search,
    fetchPopular,
    setCurrent,
    clearCurrent,
    clearSearch,
    setError: setErrorState,
    clearError: clearErrorState,
    reset,
  };
}
