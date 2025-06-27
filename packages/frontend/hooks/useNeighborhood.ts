import { useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useOxy } from '@oxyhq/services';
import { RootState, AppDispatch } from '@/store/store';
import {
  fetchNeighborhoodByLocation,
  fetchNeighborhoodByName,
  fetchNeighborhoodByProperty,
  searchNeighborhoods,
  fetchPopularNeighborhoods,
  setCurrentNeighborhood,
  clearCurrentNeighborhood,
  clearSearchResults,
  setError,
  clearError,
  resetNeighborhood,
} from '@/store/reducers/neighborhoodReducer';
import type { NeighborhoodFilters } from '@/services/neighborhoodService';

export function useNeighborhood() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  
  const {
    currentNeighborhood,
    popularNeighborhoods,
    searchResults,
    isLoading,
    isSearching,
    error,
    lastFetched,
  } = useSelector((state: RootState) => state.neighborhood);

  const isAuthenticated = !!(oxyServices && activeSessionId);

  // Fetch neighborhood by location
  const fetchByLocation = useCallback(
    async (latitude: number, longitude: number) => {
      if (!isAuthenticated) {
        console.log('useNeighborhood: User not authenticated, skipping API call');
        return;
      }

      try {
        await dispatch(fetchNeighborhoodByLocation({
          latitude,
          longitude,
          oxyServices,
          activeSessionId,
        })).unwrap();
      } catch (error) {
        console.error('useNeighborhood: Failed to fetch neighborhood by location:', error);
      }
    },
    [dispatch, oxyServices, activeSessionId, isAuthenticated]
  );

  // Fetch neighborhood by name
  const fetchByName = useCallback(
    async (name: string, city?: string, state?: string) => {
      if (!isAuthenticated) {
        console.log('useNeighborhood: User not authenticated, skipping API call');
        return;
      }

      try {
        await dispatch(fetchNeighborhoodByName({
          name,
          city,
          state,
          oxyServices,
          activeSessionId,
        })).unwrap();
      } catch (error) {
        console.error('useNeighborhood: Failed to fetch neighborhood by name:', error);
      }
    },
    [dispatch, oxyServices, activeSessionId, isAuthenticated]
  );

  // Fetch neighborhood by property
  const fetchByProperty = useCallback(
    async (propertyId: string) => {
      if (!isAuthenticated) {
        console.log('useNeighborhood: User not authenticated, skipping API call');
        return;
      }

      try {
        await dispatch(fetchNeighborhoodByProperty({
          propertyId,
          oxyServices,
          activeSessionId,
        })).unwrap();
      } catch (error) {
        console.error('useNeighborhood: Failed to fetch neighborhood by property:', error);
      }
    },
    [dispatch, oxyServices, activeSessionId, isAuthenticated]
  );

  // Search neighborhoods
  const search = useCallback(
    async (filters: NeighborhoodFilters) => {
      if (!isAuthenticated) {
        console.log('useNeighborhood: User not authenticated, skipping API call');
        return;
      }

      try {
        await dispatch(searchNeighborhoods({
          filters,
          oxyServices,
          activeSessionId,
        })).unwrap();
      } catch (error) {
        console.error('useNeighborhood: Failed to search neighborhoods:', error);
      }
    },
    [dispatch, oxyServices, activeSessionId, isAuthenticated]
  );

  // Fetch popular neighborhoods
  const fetchPopular = useCallback(
    async (city: string, state?: string, limit?: number) => {
      if (!isAuthenticated) {
        console.log('useNeighborhood: User not authenticated, skipping API call');
        return;
      }

      try {
        await dispatch(fetchPopularNeighborhoods({
          city,
          state,
          limit,
          oxyServices,
          activeSessionId,
        })).unwrap();
      } catch (error) {
        console.error('useNeighborhood: Failed to fetch popular neighborhoods:', error);
      }
    },
    [dispatch, oxyServices, activeSessionId, isAuthenticated]
  );

  // Manual actions
  const setCurrent = useCallback(
    (neighborhood: any) => {
      dispatch(setCurrentNeighborhood(neighborhood));
    },
    [dispatch]
  );

  const clearCurrent = useCallback(() => {
    dispatch(clearCurrentNeighborhood());
  }, [dispatch]);

  const clearSearch = useCallback(() => {
    dispatch(clearSearchResults());
  }, [dispatch]);

  const setErrorState = useCallback(
    (error: string | null) => {
      dispatch(setError(error));
    },
    [dispatch]
  );

  const clearErrorState = useCallback(() => {
    dispatch(clearError());
  }, [dispatch]);

  const reset = useCallback(() => {
    dispatch(resetNeighborhood());
  }, [dispatch]);

  // Check if data is stale (older than 5 minutes)
  const isDataStale = useCallback(() => {
    if (!lastFetched) return true;
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() - lastFetched > fiveMinutes;
  }, [lastFetched]);

  return {
    // State
    currentNeighborhood,
    popularNeighborhoods,
    searchResults,
    isLoading,
    isSearching,
    error,
    lastFetched,
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