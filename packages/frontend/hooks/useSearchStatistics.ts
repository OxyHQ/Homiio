import { useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/store/store';
import { setLoading, setData, setError } from '@/store/reducers/searchStatisticsReducer';

interface SearchStatistics {
  recentSearches: string[];
  popularSearches: string[];
  propertyTypeCounts: { [key: string]: number };
  cityCounts: { [key: string]: number };
}

export const useSearchStatistics = () => {
  const { oxyServices, activeSessionId } = useOxy();
  const dispatch = useDispatch<AppDispatch>();
  
  // Get search statistics from Redux store
  const { data, loading, error } = useSelector((state: RootState) => state.searchStatistics);

  useEffect(() => {
    const fetchStatistics = async () => {
      dispatch(setLoading(true));
      try {
        // For authenticated users, get their personal search statistics
        if (oxyServices && activeSessionId) {
          const response = await api.get<SearchStatistics>('/api/search/statistics', {
            oxyServices,
            activeSessionId,
          });
          // Dispatch to Redux store
          dispatch(setData(response.data));
        } else {
          // For unauthenticated users, get general statistics
          const response = await api.get<SearchStatistics>('/api/search/statistics/public');
          dispatch(setData(response.data));
        }
      } catch (error) {
        console.error('Failed to fetch search statistics:', error);
        // Return fallback data if API fails
        const fallbackData = {
          recentSearches: [],
          popularSearches: [
            'Barcelona apartments',
            'Berlin co-living', 
            'Amsterdam studios',
            'Stockholm eco-friendly',
            'London furnished',
            'Paris city center',
          ],
          propertyTypeCounts: {
            apartment: 128,
            house: 94,
            room: 75,
            studio: 103,
          },
          cityCounts: {
            Barcelona: 128,
            Berlin: 94,
            Amsterdam: 103,
            Stockholm: 75,
            London: 156,
            Paris: 89,
          },
        };
        dispatch(setData(fallbackData));
      }
    };

    fetchStatistics();
  }, [oxyServices, activeSessionId, dispatch]);

  return {
    data,
    loading,
    error,
  };
}; 