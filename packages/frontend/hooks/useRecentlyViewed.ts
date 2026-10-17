/**
 * The signed-in person's recently viewed listings — a React Query read of the
 * server's history, and nothing else.
 *
 * Account-only. The server records a view when the detail screen opens a
 * listing (`useRecordPropertyOpen`), so nothing here records anything, and a
 * signed-out viewer has no history: every surface reading this renders nothing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from 'react-i18next';
import type { Property } from '@homiio/shared-types';
import { recentlyViewedService } from '@/services/recentlyViewedService';

/** Every account's history lives under this prefix; opening a listing marks it stale. */
export const RECENTLY_VIEWED_KEY = ['recentlyViewed'] as const;

const NO_PROPERTIES: Property[] = [];

export function useRecentlyViewed() {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  // Keyed by session, so switching account never shows the previous one's history.
  const queryKey = [...RECENTLY_VIEWED_KEY, activeSessionId];

  const query = useQuery({
    queryKey,
    queryFn: () => recentlyViewedService.list(),
    enabled: Boolean(oxyServices && activeSessionId),
    staleTime: 1000 * 30,
  });

  const clearMutation = useMutation({
    mutationFn: () => recentlyViewedService.clear(),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, NO_PROPERTIES);
      toast.success(t('recentlyViewed.clearSuccess'));
    },
    onError: () => {
      toast.error(t('recentlyViewed.clearFailed'));
    },
  });

  return {
    properties: query.data ?? NO_PROPERTIES,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    clear: () => clearMutation.mutate(),
  };
}
