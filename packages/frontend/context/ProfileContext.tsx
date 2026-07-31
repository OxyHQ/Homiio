import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useOxy } from '@oxyhq/services';
import { useProfileStore } from '@/store/profileStore';
import type { Profile } from '@/services/profileService';
import { logger } from '@/utils/logger';

interface ProfileContextType {
  profile: Profile | null;
  hasProfile: boolean;
  canAccessRoommates: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { oxyServices, activeSessionId, isAuthenticated } = useOxy();
  // SELECTORS, not `useProfileStore()`. Subscribing to the whole store re-renders
  // this provider on every `set()` — including the `set({ isLoading: true })`
  // that `fetchProfile` issues synchronously, which is the cascading render the
  // effect below was reported for. Nothing here reads `isLoading`, so selecting
  // only what is used removes the re-render rather than hiding it.
  const profile = useProfileStore((s) => s.profile);
  const setProfile = useProfileStore((s) => s.setProfile);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);

  useEffect(() => {
    let mounted = true;

    if (isAuthenticated && oxyServices && activeSessionId) {
      fetchProfile().catch((loadError) => {
        if (mounted) {
          logger.error('ProfileContext: fetchProfile failed', loadError);
        }
      });
    } else if (!isAuthenticated) {
      setProfile(null);
    }

    return () => {
      mounted = false;
    };
  }, [isAuthenticated, oxyServices, activeSessionId, fetchProfile, setProfile]);

  const hasProfile = profile !== null;

  const canAccessRoommates = useMemo(
    () => Boolean(profile?.personalProfile?.settings?.roommate?.enabled),
    [profile?.personalProfile?.settings?.roommate?.enabled],
  );

  const contextValue = useMemo(
    () => ({ profile, hasProfile, canAccessRoommates }),
    [profile, hasProfile, canAccessRoommates],
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
