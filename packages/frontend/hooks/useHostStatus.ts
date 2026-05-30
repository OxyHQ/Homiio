import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { useProfile } from '@/context/ProfileContext';
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
  const { primaryProfile } = useProfile();
  const profileId = primaryProfile?._id ?? primaryProfile?.id;
  const isAuthed = Boolean(oxyServices && activeSessionId);

  const query = useQuery({
    queryKey: ['host-status', profileId ?? ''],
    queryFn: async () => {
      if (!profileId) return 0;
      const result = await propertyService.getOwnerProperties(profileId);
      return result.total;
    },
    enabled: isAuthed && Boolean(profileId),
    staleTime: 1000 * 60 * 5,
  });

  return {
    isHost: (query.data ?? 0) > 0,
    isLoading: query.isLoading,
  };
}
