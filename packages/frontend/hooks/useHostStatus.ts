import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { propertyService } from '@/services/propertyService';

/**
 * Determine whether the current user owns any properties (and is therefore
 * a host eligible to see host-only navigation entries).
 *
 * Uses a short-lived TanStack query (no Zustand state) so multiple consumers
 * dedupe naturally. Disabled when the user is not authenticated or has no
 * profile.
 */
export function useHostStatus(): {
  isHost: boolean;
  isLoading: boolean;
} {
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);

  const query = useQuery({
    queryKey: ['host-status'],
    queryFn: async () => {
      const result = await propertyService.getMyProperties(1, 1);
      return result.total;
    },
    enabled: isAuthed,
    staleTime: 1000 * 60 * 5,
  });

  return {
    isHost: (query.data ?? 0) > 0,
    isLoading: query.isLoading,
  };
}
