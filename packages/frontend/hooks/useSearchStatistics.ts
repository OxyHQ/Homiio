import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';

interface SearchStatistics {
  recentSearches: string[];
  popularSearches: string[];
  propertyTypeCounts: { [key: string]: number };
  cityCounts: { [key: string]: number };
}

export const useSearchStatistics = () => {
  const { oxyServices, activeSessionId } = useOxy();

  return useQuery({
    queryKey: ['searchStatistics', activeSessionId],
    queryFn: async (): Promise<SearchStatistics> => {
      try {
        // For authenticated users, get their personal search statistics
        if (oxyServices && activeSessionId) {
          const response = await api.get<SearchStatistics>('/api/search/statistics', {
            oxyServices,
            activeSessionId,
          });
          return response.data;
        }
        
        // For unauthenticated users, get general statistics
        const response = await api.get<SearchStatistics>('/api/search/statistics/public');
        return response.data;
      } catch (error) {
        console.error('Failed to fetch search statistics:', error);
        // Return fallback data if API fails
        return {
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
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}; 