import type React from 'react';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProfileStore } from '@/store/profileStore';
import { ProfileOwnerChangedError, useProfileOwner } from '@/hooks/useProfileOwner';
import type { Profile } from '@/services/profileService';
import { logger } from '@/utils/logger';

interface ProfileContextType {
  profile: Profile | null;
  hasProfile: boolean;
  canAccessRoommates: boolean;
  refreshProfile: () => Promise<Profile | null>;
  isProfileProjectionCurrent: () => boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const owner = useProfileOwner();
  const queryClient = useQueryClient();
  // SELECTOR, not `useProfileStore()`: nothing here reads `isLoading`, so the
  // `set({ isLoading: true })` each fetch issues must not re-render the provider.
  const storedProfile = useProfileStore((s) => s.profile);
  const binding = useProfileStore((s) => s.profileBinding);
  const profileUpdatedAt = useProfileStore((s) => s.profileUpdatedAt);
  const sameBinding = Boolean(
    owner && binding?.userId === owner.userId && binding.sessionId === owner.sessionId,
  );
  const queryKey = ['profile', 'me', owner?.sessionId ?? null, owner?.revision ?? null] as const;
  useLayoutEffect(
    () => () => {
      if (owner) useProfileStore.getState().releaseProfileOwner(owner);
    },
    [owner],
  );

  // A committed owner revision keeps a late query result or error separate
  // from the next projection, even when the same session returns later.
  const sessionProfile = useQuery({
    queryKey,
    queryFn: () => {
      if (!owner) throw new ProfileOwnerChangedError();
      return useProfileStore
        .getState()
        .fetchProfile(owner)
        .catch((loadError: unknown) => {
          if (owner.isCurrent()) logger.error('ProfileContext: fetchProfile failed', loadError);
          throw loadError;
        });
    },
    enabled: Boolean(owner),
    initialData: sameBinding ? storedProfile : undefined,
    initialDataUpdatedAt: sameBinding ? profileUpdatedAt : undefined,
  });

  // A cached profile is reusable only for the same observed user and session.
  // That local match is not an actor authorization check.
  const profile =
    owner?.isCurrent() && sameBinding && sessionProfile.data !== undefined ? storedProfile : null;
  const refreshProfile = useCallback(async () => {
    if (!owner?.isCurrent()) throw new ProfileOwnerChangedError();
    const result = await useProfileStore.getState().fetchProfile(owner);
    if (!owner.isCurrent()) throw new ProfileOwnerChangedError();
    queryClient.setQueryData(['profile', 'me', owner.sessionId, owner.revision], result);
    return result;
  }, [owner, queryClient]);
  const isProfileProjectionCurrent = useCallback(() => Boolean(owner?.isCurrent()), [owner]);

  const hasProfile = profile !== null;

  const canAccessRoommates = useMemo(
    () => Boolean(profile?.personalProfile?.settings?.roommate?.enabled),
    [profile?.personalProfile?.settings?.roommate?.enabled],
  );

  const contextValue = useMemo(
    () => ({ profile, hasProfile, canAccessRoommates, refreshProfile, isProfileProjectionCurrent }),
    [profile, hasProfile, canAccessRoommates, refreshProfile, isProfileProjectionCurrent],
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
