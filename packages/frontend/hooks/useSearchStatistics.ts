import { useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';
import { useSearchStatisticsStore } from '@/store/searchStatisticsStore';

interface SearchStatistics {
  recentSearches: string[];
  popularSearches: string[];
  propertyTypeCounts: { [key: string]: number };
  cityCounts: { [key: string]: number };
}

export const useSearchStatistics = () => {
  const { oxyServices, activeSessionId } = useOxy();
  const { statistics, isLoading, error, setStatistics, setLoading, setError } =
    useSearchStatisticsStore();

  useEffect(() => {
    const fetchStatistics = async () => {
      setLoading(true);
      try {
        // For authenticated users, get their personal search statistics
        if (oxyServices && activeSessionId) {
          const response = await api.get<SearchStatistics>('/api/search/statistics', {
            oxyServices,
            activeSessionId,
          });
          // Set data in Zustand store
          setStatistics({
            totalSearches: 0,
            recentSearches: response.data.recentSearches || [],
            popularSearches: response.data.popularSearches || [],
            searchTrends: [],
          });
        } else {
          // For unauthenticated users, get general statistics
          const response = await api.get<SearchStatistics>('/api/search/statistics/public');
          setStatistics({
            totalSearches: 0,
            recentSearches: response.data.recentSearches || [],
            popularSearches: response.data.popularSearches || [],
            searchTrends: [],
          });
        }
      } catch (error) {
        // Return fallback data if API fails
        const fallbackData = {
          totalSearches: 0,
          recentSearches: [],
          popularSearches: [
            'Barcelona apartments',
            'Berlin co-living',
            'Amsterdam studios',
            'Stockholm eco-friendly',
            'London furnished',
            'Paris city center',
          ],
          searchTrends: [],
        };
        setStatistics(fallbackData);
      } finally {
        setLoading(false);
      }
    };

    fetchStatistics();
  }, [oxyServices, activeSessionId, setStatistics, setLoading]);

  return {
    data: statistics,
    loading: isLoading,
    error,
  };
};
