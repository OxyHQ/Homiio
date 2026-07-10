import React, { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@oxyhq/services';
import { useProfileStore } from '@/store/profileStore';
import type { Profile } from '@/services/profileService';
import { logger } from '@/utils/logger';

interface ProfileContextType {
  profile: Profile | null;
  /** @deprecated Use profile */
  primaryProfile: Profile | null;
  isLoading: boolean;
  error: string | null;
  hasProfile: boolean;
  refetch: () => void;
  canAccessRoommates: boolean;
  /** @deprecated Always true when profile exists — use Oxy account kind for gating */
  isPersonalProfile: boolean;
  /** @deprecated Use hasProfile */
  hasPersonalProfile: boolean;
  refresh: () => Promise<void>;
  isInitialized: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const { profile, isLoading, error, setProfile, setError, fetchProfile, reset } = useProfileStore();
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

    if (isAuthenticated) {
      loadProfile().catch((loadError) => {
        if (mounted) logger.error('ProfileContext: loadProfile failed', loadError);
      });
    } else {
      reset();
      setIsInitialized(false);
    }

    return () => {
      mounted = false;
    };
  }, [isAuthenticated, loadProfile, reset]);

  const canAccessRoommates = useMemo(
    () => Boolean(profile?.personalProfile?.settings?.roommate?.enabled),
    [profile?.personalProfile?.settings?.roommate?.enabled],
  );

  const refetch = useCallback(() => {
    if (isAuthenticated) {
      loadProfile().catch(() => undefined);
    }
  }, [isAuthenticated, loadProfile]);

  const contextValue = useMemo(
    () => ({
      profile,
      primaryProfile: profile,
      isLoading,
      error,
      hasProfile: profile !== null,
      refetch,
      canAccessRoommates,
      isPersonalProfile: profile !== null,
      hasPersonalProfile: profile !== null,
      refresh,
      isInitialized,
    }),
    [profile, isLoading, error, refetch, canAccessRoommates, refresh, isInitialized],
  );

  return <ProfileContext.Provider value={contextValue}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}

/** @deprecated Use useProfile().profile */
export function usePersonalProfile() {
  return useProfile().profile;
}

/** @deprecated Agency accounts are Oxy org accounts — use Oxy SDK. */
export function useAgencyProfiles() {
  return [] as Profile[];
}

/** @deprecated */
export function useBusinessProfiles() {
  return [] as Profile[];
}

/** @deprecated */
export function useOwnedAgencyProfiles() {
  return [] as Profile[];
}
