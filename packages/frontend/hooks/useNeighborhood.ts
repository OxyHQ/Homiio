import { useCallback } from 'react';
import { useNeighborhoodStore } from '@/store/neighborhoodStore';
import type { NeighborhoodFilters } from '@/services/neighborhoodService';
import { api } from '@/utils/api';

export function useNeighborhood() {
  const {
    currentNeighborhood,
    nearbyNeighborhoods,
    isLoading,
    error,
    setCurrentNeighborhood,
    setNearbyNeighborhoods,
    setLoading,
    setError,
    clearError,
  } = useNeighborhoodStore();


  // Fetch neighborhood by location
  const fetchByLocation = useCallback(
    async (latitude: number, longitude: number) => {
      try {
        setLoading(true);
        setError(null);

        const response = await api.get('/neighborhoods/location', {
          params: { latitude, longitude }
        });

        setCurrentNeighborhood(response.data);
      } catch (error: any) {
        setError(error.message || 'Failed to fetch neighborhood by location');
      } finally {
        setLoading(false);
      }
    },
    [setCurrentNeighborhood, setLoading, setError],
  );

  // Fetch neighborhood by name
  const fetchByName = useCallback(
    async (name: string, city?: string, state?: string) => {
      try {
        setLoading(true);
        setError(null);

        const response = await api.get('/neighborhoods/name', {
          params: { name, city, state }
        });

        setCurrentNeighborhood(response.data);
      } catch (error: any) {
        setError(error.message || 'Failed to fetch neighborhood by name');
      } finally {
        setLoading(false);
      }
    },
    [setCurrentNeighborhood, setLoading, setError],
  );

  // Fetch neighborhood by property
  const fetchByProperty = useCallback(
    async (propertyId: string) => {
      try {
        setLoading(true);
        setError(null);

        const response = await api.get(`/neighborhoods/property/${propertyId}`);

        setCurrentNeighborhood(response.data);
      } catch (error: any) {
        setError(error.message || 'Failed to fetch neighborhood by property');
      } finally {
        setLoading(false);
      }
    },
    [setCurrentNeighborhood, setLoading, setError],
  );

  // Search neighborhoods
  const search = useCallback(
    async (filters: NeighborhoodFilters) => {
      try {
        setLoading(true);
        setError(null);

        const response = await api.get('/neighborhoods/search', {
          params: filters
        });

        setNearbyNeighborhoods(response.data || []);
      } catch (error: any) {
        setError(error.message || 'Failed to search neighborhoods');
      } finally {
        setLoading(false);
      }
    },
    [setNearbyNeighborhoods, setLoading, setError],
  );

  // Fetch popular neighborhoods
  const fetchPopular = useCallback(
    async (city: string, state?: string, limit?: number) => {
      try {
        setLoading(true);
        setError(null);

        const response = await api.get('/neighborhoods/popular', {
          params: { city, state, limit }
        });

        setNearbyNeighborhoods(response.data || []);
      } catch (error: any) {
        setError(error.message || 'Failed to fetch popular neighborhoods');
      } finally {
        setLoading(false);
      }
    },
    [setNearbyNeighborhoods, setLoading, setError],
  );

  // Manual actions
  const setCurrent = useCallback(
    (neighborhood: any) => {
      setCurrentNeighborhood(neighborhood);
    },
    [setCurrentNeighborhood],
  );

  const clearCurrent = useCallback(() => {
    setCurrentNeighborhood(null);
  }, [setCurrentNeighborhood]);

  const clearSearch = useCallback(() => {
    setNearbyNeighborhoods([]);
  }, [setNearbyNeighborhoods]);

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
    setCurrentNeighborhood(null);
    setNearbyNeighborhoods([]);
    clearError();
  }, [setCurrentNeighborhood, setNearbyNeighborhoods, clearError]);

  // Check if data is stale (older than 5 minutes)
  const isDataStale = useCallback(() => {
    // Not implemented in Zustand store yet
    return false;
  }, []);

  return {
    // State
    currentNeighborhood,
    nearbyNeighborhoods,
    isLoading,
    isSearching: isLoading, // Not implemented in Zustand store yet
    error,
    lastFetched: null, // Not implemented in Zustand store yet
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
