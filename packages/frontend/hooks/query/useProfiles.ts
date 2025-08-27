import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import profileService, { type Profile, type CreateProfileData, type UpdateProfileData } from '@/services/profileService';

const keys = {
  primary: () => ['profile', 'primary'] as const,
  all: () => ['profiles', 'all'] as const,
};

export function usePrimaryProfileQuery() {
  return useQuery({
    queryKey: keys.primary(),
    queryFn: async (): Promise<Profile | null> =>
      profileService.getOrCreatePrimaryProfile(),
  });
}

export function useUserProfilesQuery() {
  return useQuery({
    queryKey: keys.all(),
    queryFn: async (): Promise<Profile[]> =>
      profileService.getUserProfiles(),
  });
}

export function useCreateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateProfileData): Promise<Profile> =>
      profileService.createProfile(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.primary() }),
        queryClient.invalidateQueries({ queryKey: keys.all() }),
      ]);
    },
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, data }: { profileId: string; data: UpdateProfileData }): Promise<Profile> =>
      profileService.updateProfile(profileId, data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.primary() }),
        queryClient.invalidateQueries({ queryKey: keys.all() }),
      ]);
    },
  });
}

export function useDeleteProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string): Promise<void> =>
      profileService.deleteProfile(profileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.all() });
    },
  });
}

export function useActivateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string): Promise<Profile> => {
      // Import profileStore dynamically to avoid circular dependencies
      const { useProfileStore } = await import('@/store/profileStore');
      
      // Call both the service and update the store state immediately
      const activatedProfile = await useProfileStore.getState().activateProfile(profileId);
      
      return activatedProfile;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.primary() }),
        queryClient.invalidateQueries({ queryKey: keys.all() }),
      ]);
    },
  });
}
