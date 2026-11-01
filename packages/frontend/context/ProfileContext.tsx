import type React from 'react';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo } from 'react';
import { isServer, useQuery, useQueryClient } from '@tanstack/react-query';
import { useProfileStore } from '@/store/profileStore';
import {
  ProfileOwnerChangedError,
  ProfileRequestSupersededError,
  useProfileOwner,
  type ProfileOwner,
} from '@/hooks/useProfileOwner';
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

/** Preserve the operation identity through the await in both query consumers. */
async function readCurrentProfile(owner: ProfileOwner) {
  const pending = useProfileStore.getState().fetchProfile(owner);
  const request = useProfileStore.getState().latestProfileRequest;
  const profile = await pending;
  if (!owner.isCurrent()) throw new ProfileOwnerChangedError();
  if (!request || useProfileStore.getState().latestProfileRequest !== request)
    throw new ProfileRequestSupersededError();
  return { profile, request };
}

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
  const queryKey = [
    'profile',
    'me',
    'provider-v2',
    owner?.sessionId ?? null,
    owner?.revision ?? null,
  ] as const;
  const configuredRetry =
    queryClient.getQueryDefaults(queryKey).retry ?? queryClient.getDefaultOptions().queries?.retry;
  useLayoutEffect(
    () => () => {
      if (owner) useProfileStore.getState().releaseProfileOwner(owner);
    },
    [owner],
  );

  // A committed owner revision keeps a late query result or error separate
  // from the next projection, even when the same session returns later.
  useQuery({
    queryKey,
    queryFn: () => {
      if (!owner) throw new ProfileOwnerChangedError();
      return readCurrentProfile(owner)
        .then(({ request }) => {
          if (useProfileStore.getState().latestProfileRequest !== request)
            throw new ProfileRequestSupersededError();
          return true;
        })
        .catch((loadError: unknown) => {
          if (owner.isCurrent() && !(loadError instanceof ProfileRequestSupersededError))
            logger.error('ProfileContext: fetchProfile failed', loadError);
          throw loadError;
        });
    },
    enabled: Boolean(owner),
    retry: (count, error) => {
      if (error instanceof ProfileRequestSupersededError) return false;
      if (typeof configuredRetry === 'function') return configuredRetry(count, error);
      if (typeof configuredRetry === 'number') return count < configuredRetry;
      return configuredRetry ?? (isServer ? false : count < 3);
    },
    initialData: sameBinding ? true : undefined,
    initialDataUpdatedAt: sameBinding ? profileUpdatedAt : undefined,
  });

  // A cached profile is reusable only for the same observed user and session.
  // That local match is not an actor authorization check.
  const profile = owner?.isCurrent() && sameBinding ? storedProfile : null;
  const refreshProfile = useCallback(async () => {
    if (!owner?.isCurrent()) throw new ProfileOwnerChangedError();
    const { profile, request } = await readCurrentProfile(owner);
    if (!owner.isCurrent()) throw new ProfileOwnerChangedError();
    if (useProfileStore.getState().latestProfileRequest !== request)
      throw new ProfileRequestSupersededError();
    queryClient.setQueryData(
      ['profile', 'me', 'provider-v2', owner.sessionId, owner.revision],
      true,
    );
    return profile;
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
