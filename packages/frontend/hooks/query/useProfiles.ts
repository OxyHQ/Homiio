import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import profileService, { type Profile, type UpdateProfileData } from '@/services/profileService';
import {
  accountOwnerKey,
  assertAccountOwner,
  type AccountOwner,
  sameAccountProjection,
  useAccountOwnerGuard,
  withAccountOwner,
} from '@/hooks/useAccountOwner';

/** Session ID may appear after the same account is restored; generation detects later switches. */
export function profileOwnerKey(owner: AccountOwner | null) {
  const [userId, , epoch, instance, generation] = accountOwnerKey(owner);
  return ['profile', 'me', 'owned-v1', userId, epoch, instance, generation] as const;
}

export function useProfileQuery(expectedOwner?: AccountOwner) {
  const { owner: projected } = useAccountOwnerGuard();
  const owner =
    expectedOwner && !sameAccountProjection(expectedOwner, projected) ? null : projected;
  const query = useQuery({
    queryKey: profileOwnerKey(owner),
    enabled: Boolean(owner),
    queryFn: (): Promise<Profile | null> =>
      withAccountOwner(owner, async (current) => {
        const profile = await profileService.getOrCreateProfile(current);
        if (profile && profile.oxyUserId !== current.userId)
          throw new Error('The profile does not belong to the active account');
        return profile;
      }),
  });
  return { ...query, ownerReady: Boolean(owner) };
}

export function useUpdateProfileMutation(
  owner: AccountOwner,
  isCurrent: (owner: AccountOwner | null) => boolean,
) {
  const queryClient = useQueryClient();
  // Mutation variables remain serializable. A restored action has no live owner
  // and must not be replayed against whichever account happens to be active.
  const owners = useRef(new WeakMap<UpdateProfileData, AccountOwner>());
  const mutation = useMutation({
    mutationFn: (data: UpdateProfileData): Promise<Profile> => {
      const captured = owners.current.get(data);
      if (!captured || !isCurrent(captured)) throw new Error('The active account changed');
      return withAccountOwner(captured, async (current) => {
        const profile = await profileService.updateMyProfile(data, current);
        if (profile.oxyUserId !== current.userId)
          throw new Error('The profile does not belong to the active account');
        return profile;
      });
    },
    onSuccess: async (_profile, data) => {
      const captured = owners.current.get(data);
      if (!captured) return;
      try {
        assertAccountOwner(captured);
      } catch {
        return;
      }
      if (!isCurrent(captured)) {
        await queryClient.invalidateQueries({
          queryKey: profileOwnerKey(captured),
          exact: true,
          refetchType: 'none',
        });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['profile', 'me'] });
    },
  });
  return {
    mutateAsync: (data: UpdateProfileData) => {
      if (!isCurrent(owner)) return Promise.reject(new Error('The active account changed'));
      owners.current.set(data, owner);
      return mutation.mutateAsync(data);
    },
  };
}
