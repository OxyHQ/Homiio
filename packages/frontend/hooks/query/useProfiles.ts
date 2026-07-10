import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import profileService, { type Profile, type UpdateProfileData } from '@/services/profileService';

const keys = {
  profile: () => ['profile', 'me'] as const,
};

export function useProfileQuery() {
  return useQuery({
    queryKey: keys.profile(),
    queryFn: async (): Promise<Profile> => profileService.getOrCreateProfile(),
  });
}

/** @deprecated Use useProfileQuery — one sidecar per Oxy account. */
export function usePrimaryProfileQuery() {
  return useProfileQuery();
}

/** @deprecated Multi-profile listing removed. */
export function useUserProfilesQuery() {
  const query = useProfileQuery();
  return {
    ...query,
    data: query.data ? [query.data] : [],
  };
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, data }: { profileId: string; data: UpdateProfileData }): Promise<Profile> =>
      profileService.updateProfile(profileId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.profile() });
    },
  });
}
