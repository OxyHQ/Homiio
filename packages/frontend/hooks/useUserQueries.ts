import { useQuery } from '@tanstack/react-query';
import { userService } from '@/services/userService';
import type { Property } from '@/services/propertyService';

export const userKeys = {
  recentProperties: () => ['user', 'recent-properties'] as const,
};

export function useRecentlyViewedProperties() {
  return useQuery<Property[]>({
    queryKey: userKeys.recentProperties(),
    queryFn: () => userService.getRecentlyViewedProperties(),
    staleTime: 5 * 60 * 1000,
  });
}
