import type React from 'react';
import { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
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
  // SELECTOR, not `useProfileStore()`: nothing here reads `isLoading`, so the
  // `set({ isLoading: true })` each fetch issues must not re-render the provider.
  const storedProfile = useProfileStore((s) => s.profile);
  const signedIn = Boolean(isAuthenticated && oxyServices && activeSessionId);

  // Loading the signed-in user's profile is a fetch, so React Query owns WHEN
  // it happens (once per session, keyed on it). The store's `fetchProfile`
  // stays the mechanism because other screens refresh and update the same
  // store entry; the query is what triggers it.
  const sessionProfile = useQuery({
    queryKey: ['profile', 'me', activeSessionId ?? null],
    queryFn: () =>
      useProfileStore
        .getState()
        .fetchProfile()
        .catch((loadError: unknown) => {
          logger.error('ProfileContext: fetchProfile failed', loadError);
          throw loadError;
        }),
    enabled: signedIn,
  });

  // The store entry only belongs to this session once this session's fetch has
  // landed; until then (and whenever signed out) there is no profile, so a
  // previous account's profile can never show through.
  const profile = signedIn && sessionProfile.data !== undefined ? storedProfile : null;

  const hasProfile = profile !== null;

  const canAccessRoommates = useMemo(
    () => Boolean(profile?.personalProfile?.settings?.roommate?.enabled),
    [profile?.personalProfile?.settings?.roommate?.enabled],
  );

  const contextValue = useMemo(
    () => ({ profile, hasProfile, canAccessRoommates }),
    [profile, hasProfile, canAccessRoommates],
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
