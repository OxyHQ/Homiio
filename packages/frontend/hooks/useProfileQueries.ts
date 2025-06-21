import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import profileService, { 
  Profile, 
  CreateProfileData, 
  UpdateProfileData 
} from '@/services/profileService';
import { toast } from 'sonner';

// Query keys
export const profileKeys = {
  all: ['profiles'] as const,
  primary: () => [...profileKeys.all, 'primary'] as const,
  userProfiles: () => [...profileKeys.all, 'user'] as const,
  byType: (type: string) => [...profileKeys.all, 'type', type] as const,
  agencyMemberships: () => [...profileKeys.all, 'agency-memberships'] as const,
  byId: (id: string) => [...profileKeys.all, 'id', id] as const,
};

// Hook to get or create primary profile
export function usePrimaryProfile() {
  return useQuery<Profile>({
    queryKey: profileKeys.primary(),
    queryFn: () => profileService.getOrCreatePrimaryProfile(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to get all user profiles
export function useUserProfiles() {
  return useQuery<Profile[]>({
    queryKey: profileKeys.userProfiles(),
    queryFn: () => profileService.getUserProfiles(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to get profile by type
export function useProfileByType(profileType: 'personal' | 'roommate' | 'agency') {
  return useQuery<Profile>({
    queryKey: profileKeys.byType(profileType),
    queryFn: () => profileService.getProfileByType(profileType),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to get agency memberships
export function useAgencyMemberships() {
  return useQuery<Profile[]>({
    queryKey: profileKeys.agencyMemberships(),
    queryFn: () => profileService.getAgencyMemberships(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to create a new profile
export function useCreateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileData: CreateProfileData) => profileService.createProfile(profileData),
    onSuccess: () => {
      // Invalidate and refetch profile queries
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast.success('Profile created successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create profile');
    },
  });
}

// Hook to update primary profile (no profile ID needed)
export function useUpdatePrimaryProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updateData: UpdateProfileData) => profileService.updatePrimaryProfile(updateData),
    onSuccess: (data: Profile) => {
      // Update the cache directly instead of invalidating to avoid auth issues
      queryClient.setQueryData(profileKeys.primary(), data);
      queryClient.setQueryData(profileKeys.all, (oldData: Profile[] | undefined) => {
        if (!oldData) return [data];
        return oldData.map(profile => 
          profile.id === data.id ? data : profile
        );
      });
      toast.success('Profile updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update profile');
    },
  });
}

// Hook to update primary profile trust score (no profile ID needed)
export function useUpdatePrimaryTrustScore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ factor, value }: { factor: string; value: number }) =>
      profileService.updatePrimaryTrustScore(factor, value),
    onSuccess: (data: Profile) => {
      // Invalidate and refetch profile queries
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      queryClient.invalidateQueries({ queryKey: profileKeys.primary() });
      toast.success('Trust score updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update trust score');
    },
  });
}

// Hook to update a profile
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ profileId, updateData }: { profileId: string; updateData: UpdateProfileData }) =>
      profileService.updateProfile(profileId, updateData),
    onSuccess: (data: Profile, variables: { profileId: string; updateData: UpdateProfileData }) => {
      // Invalidate and refetch profile queries
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      queryClient.invalidateQueries({ queryKey: profileKeys.byId(variables.profileId) });
      toast.success('Profile updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update profile');
    },
  });
}

// Hook to delete a profile
export function useDeleteProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileId: string) => profileService.deleteProfile(profileId),
    onSuccess: () => {
      // Invalidate and refetch profile queries
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast.success('Profile deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete profile');
    },
  });
}

// Hook to add agency member
export function useAddAgencyMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ 
      profileId, 
      memberOxyUserId, 
      role 
    }: { 
      profileId: string; 
      memberOxyUserId: string; 
      role: 'owner' | 'admin' | 'agent' | 'viewer' 
    }) => profileService.addAgencyMember(profileId, memberOxyUserId, role),
    onSuccess: (data: Profile, variables: { profileId: string; memberOxyUserId: string; role: 'owner' | 'admin' | 'agent' | 'viewer' }) => {
      // Invalidate and refetch profile queries
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      queryClient.invalidateQueries({ queryKey: profileKeys.byId(variables.profileId) });
      toast.success('Agency member added successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to add agency member');
    },
  });
}

// Hook to remove agency member
export function useRemoveAgencyMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ 
      profileId, 
      memberOxyUserId 
    }: { 
      profileId: string; 
      memberOxyUserId: string; 
    }) => profileService.removeAgencyMember(profileId, memberOxyUserId),
    onSuccess: (data: Profile, variables: { profileId: string; memberOxyUserId: string }) => {
      // Invalidate and refetch profile queries
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      queryClient.invalidateQueries({ queryKey: profileKeys.byId(variables.profileId) });
      toast.success('Agency member removed successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to remove agency member');
    },
  });
}

// Hook to update trust score
export function useUpdateTrustScore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ 
      profileId, 
      factor, 
      value 
    }: { 
      profileId: string; 
      factor: string; 
      value: number; 
    }) => profileService.updateTrustScore(profileId, factor, value),
    onSuccess: (data: Profile, variables: { profileId: string; factor: string; value: number }) => {
      // Invalidate and refetch profile queries
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      queryClient.invalidateQueries({ queryKey: profileKeys.byId(variables.profileId) });
      toast.success('Trust score updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update trust score');
    },
  });
} 