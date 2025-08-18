import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import profileService, { type Profile, type CreateProfileData, type UpdateProfileData } from '@/services/profileService';
import { useOxy } from '@oxyhq/services';

const keys = {
  primary: (activeSessionId?: string) => ['profile', 'primary', activeSessionId] as const,
  all: (activeSessionId?: string) => ['profiles', 'all', activeSessionId] as const,
};

export function usePrimaryProfileQuery() {
  const { oxyServices, activeSessionId } = useOxy();
  return useQuery({
    queryKey: keys.primary(activeSessionId ?? undefined),
    enabled: !!oxyServices && !!activeSessionId,
    queryFn: async (): Promise<Profile | null> =>
      profileService.getOrCreatePrimaryProfile(oxyServices, activeSessionId ?? undefined),
  });
}

export function useUserProfilesQuery() {
  const { oxyServices, activeSessionId } = useOxy();
  return useQuery({
    queryKey: keys.all(activeSessionId ?? undefined),
    enabled: !!oxyServices && !!activeSessionId,
    queryFn: async (): Promise<Profile[]> =>
      profileService.getUserProfiles(oxyServices, activeSessionId ?? undefined),
  });
}

export function useCreateProfileMutation() {
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateProfileData): Promise<Profile> =>
      profileService.createProfile(payload, oxyServices, activeSessionId ?? undefined),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.primary(activeSessionId ?? undefined) }),
        queryClient.invalidateQueries({ queryKey: keys.all(activeSessionId ?? undefined) }),
      ]);
    },
  });
}

export function useUpdateProfileMutation() {
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, data }: { profileId: string; data: UpdateProfileData }): Promise<Profile> =>
      profileService.updateProfile(profileId, data, oxyServices, activeSessionId ?? undefined),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.primary(activeSessionId ?? undefined) }),
        queryClient.invalidateQueries({ queryKey: keys.all(activeSessionId ?? undefined) }),
      ]);
    },
  });
}

export function useDeleteProfileMutation() {
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string): Promise<void> =>
      profileService.deleteProfile(profileId, oxyServices, activeSessionId ?? undefined),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.all(activeSessionId ?? undefined) });
    },
  });
}

export function useActivateProfileMutation() {
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string): Promise<Profile> =>
      profileService.activateProfile(profileId, oxyServices, activeSessionId ?? undefined),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.primary(activeSessionId ?? undefined) }),
        queryClient.invalidateQueries({ queryKey: keys.all(activeSessionId ?? undefined) }),
      ]);
    },
  });
}
