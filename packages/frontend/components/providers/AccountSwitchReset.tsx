import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@oxyhq/services';
import { useProfileStore } from '@/store/profileStore';

/**
 * Clears Homiio-scoped React Query cache and Zustand slices when the active
 * Oxy account switches (not on cold boot restore or sign-out).
 */
export function AccountSwitchReset() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const resetProfile = useProfileStore((s: ReturnType<typeof useProfileStore.getState>) => s.reset);
  const prevUserIdRef = useRef<string | null>(null);

  const userId = user?.id ?? null;
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (prev && userId && prev !== userId) {
      resetProfile();
      queryClient.clear();
    }
  }, [userId, queryClient, resetProfile]);

  return null;
}
