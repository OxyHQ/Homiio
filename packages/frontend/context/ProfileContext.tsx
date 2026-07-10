import React, { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { useOxy } from '@oxyhq/services';
import { useProfileStore } from '@/store/profileStore';
import type { Profile } from '@/services/profileService';
import { logger } from '@/utils/logger';

interface ProfileContextType {
  profile: Profile | null;
  isLoading: boolean;
  error: string | null;
  hasProfile: boolean;
  refetch: () => void;
  canAccessRoommates: boolean;
  refresh: () => Promise<void>;
  isInitialized: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { oxyServices, activeSessionId, isAuthenticated } = useOxy();
  const {
    profile,
    isLoading,
    error,
    setProfile,
    setError,
    fetchProfile,
  } = useProfileStore();

  const [isInitialized, setIsInitialized] = React.useState(false);

  const loadProfile = useCallback(async () => {
    try {
      await fetchProfile();
      setIsInitialized(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load profile';
      setError(message);
      setIsInitialized(true);
    }
  }, [fetchProfile, setError]);

  const refresh = useCallback(async () => {
    setIsInitialized(false);
    await loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    let mounted = true;

    if (isAuthenticated && oxyServices && activeSessionId) {
      loadProfile().catch((loadError) => {
        if (mounted) {
          logger.error('ProfileContext: loadProfile failed', loadError);
        }
      });
    } else if (!isAuthenticated) {
      setProfile(null);
      setIsInitialized(false);
    }

    return () => {
      mounted = false;
    };
  }, [isAuthenticated, oxyServices, activeSessionId, loadProfile, setProfile]);

  const hasProfile = profile !== null;

  const canAccessRoommates = useMemo(
    () => Boolean(profile?.personalProfile?.settings?.roommate?.enabled),
    [profile?.personalProfile?.settings?.roommate?.enabled],
  );

  const refetch = useCallback(() => {
    if (isAuthenticated && oxyServices && activeSessionId) {
      loadProfile().catch(() => {});
    }
  }, [isAuthenticated, oxyServices, activeSessionId, loadProfile]);

  const contextValue = useMemo(
    () => ({
      profile,
      isLoading,
      error,
      hasProfile,
      refetch,
      canAccessRoommates,
      refresh,
      isInitialized,
    }),
    [profile, isLoading, error, hasProfile, refetch, canAccessRoommates, refresh, isInitialized],
  );

  return (
    <ProfileContext.Provider value={contextValue}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}
