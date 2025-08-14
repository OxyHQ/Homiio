import { QueryClient } from '@tanstack/react-query';
import { propertyService } from '@/services/propertyService';

export async function prefetchProperty(
  queryClient: QueryClient,
  id: string,
  oxyServices?: any,
  activeSessionId?: string,
) {
  if (!id) return;
  await queryClient.prefetchQuery({
    queryKey: ['property', id],
    queryFn: async () => propertyService.getProperty(id, oxyServices, activeSessionId || ''),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });
}

export async function prefetchPropertyStats(queryClient: QueryClient, id: string) {
  if (!id) return;
  await queryClient.prefetchQuery({
    queryKey: ['propertyStats', id],
    queryFn: async () => propertyService.getPropertyStats(id),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });
}



