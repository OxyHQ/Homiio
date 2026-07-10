import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import profileService, { type Profile, type UpdateProfileData } from '@/services/profileService';

const keys = {
  profile: () => ['profile', 'me'] as const,
};

export function useProfileQuery() {
  return useQuery({
    queryKey: keys.profile(),
    queryFn: async (): Promise<Profile | null> => profileService.getOrCreateProfile(),
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: UpdateProfileData): Promise<Profile> =>
      profileService.updateMyProfile(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.profile() });
    },
  });
}
