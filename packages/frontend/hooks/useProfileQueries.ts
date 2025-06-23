import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
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
  const { user, oxyServices, activeSessionId } = useOxy();
  
  console.log('usePrimaryProfile - user:', user ? 'authenticated' : 'not authenticated');
  
  return useQuery<Profile | null>({
    queryKey: profileKeys.primary(),
    queryFn: async () => {
      try {
        const profile = await profileService.getOrCreatePrimaryProfile(oxyServices, activeSessionId || undefined);
        // The backend now returns null when no profile exists, so we can return it directly
        return profile;
      } catch (error: any) {
        // Handle any other errors that might still occur
        console.error('Error fetching primary profile:', error);
        throw error;
      }
    },
    enabled: !!user && !!oxyServices && !!activeSessionId, // Only run when user is authenticated
    staleTime: 10 * 60 * 1000, // 10 minutes - increase stale time to reduce unnecessary fetches  
    gcTime: 30 * 60 * 1000, // 30 minutes - keep in cache longer
    refetchOnWindowFocus: false, // Reduce aggressive refetching
    refetchOnMount: false, // Don't refetch on every mount
  });
}

// Hook to get all user profiles
export function useUserProfiles() {
  const { oxyServices, activeSessionId, user } = useOxy();
  
  console.log('useUserProfiles - user:', user ? 'authenticated' : 'not authenticated');
  
  return useQuery<Profile[]>({
    queryKey: profileKeys.userProfiles(),
    queryFn: () => profileService.getUserProfiles(oxyServices, activeSessionId || undefined),
    enabled: !!user && !!oxyServices && !!activeSessionId, // Only run when user is authenticated
    staleTime: 10 * 60 * 1000, // 10 minutes - increase stale time to reduce unnecessary fetches
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false, // Reduce aggressive refetching
    refetchOnMount: true, // Don't refetch on every mount
  });
}

// Hook to get profile by type
export function useProfileByType(profileType: 'personal' | 'agency' | 'business') {
  const { user, oxyServices, activeSessionId } = useOxy();
  
  return useQuery<Profile>({
    queryKey: profileKeys.byType(profileType),
    queryFn: () => profileService.getProfileByType(profileType, oxyServices, activeSessionId || undefined),
    enabled: !!user && !!oxyServices && !!activeSessionId, // Only run when user is authenticated
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

// Hook to get agency memberships
export function useAgencyMemberships() {
  const { user, oxyServices, activeSessionId } = useOxy();
  
  return useQuery<Profile[]>({
    queryKey: profileKeys.agencyMemberships(),
    queryFn: () => profileService.getAgencyMemberships(oxyServices, activeSessionId || undefined),
    enabled: !!user && !!oxyServices && !!activeSessionId, // Only run when user is authenticated
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

// Hook to create a new profile
export function useCreateProfile() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: (profileData: CreateProfileData) => profileService.createProfile(profileData, oxyServices, activeSessionId || undefined),
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
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: (updateData: UpdateProfileData) => profileService.updatePrimaryProfile(updateData, oxyServices, activeSessionId || undefined),
    onSuccess: (data: Profile) => {
      // Immediately update the cache with the new data
      queryClient.setQueryData(profileKeys.primary(), data);
      
      // Also invalidate and refetch to ensure we have the latest data from server
      queryClient.invalidateQueries({ queryKey: profileKeys.primary() });
      queryClient.invalidateQueries({ queryKey: profileKeys.userProfiles() });
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      
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
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: ({ factor, value }: { factor: string; value: number }) =>
      profileService.updatePrimaryTrustScore(factor, value, oxyServices, activeSessionId || undefined),
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

// Hook to recalculate primary profile trust score
export function useRecalculatePrimaryTrustScore() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: () => profileService.recalculatePrimaryTrustScore(oxyServices, activeSessionId || undefined),
    onSuccess: (data: { profile: Profile; trustScore: any }) => {
      // Invalidate and refetch profile queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: profileKeys.primary() });
      queryClient.invalidateQueries({ queryKey: profileKeys.userProfiles() });
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast.success('Trust score recalculated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to recalculate trust score');
    },
  });
}

// Hook to update a profile
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: ({ profileId, updateData }: { profileId: string; updateData: UpdateProfileData }) =>
      profileService.updateProfile(profileId, updateData, oxyServices, activeSessionId || undefined),
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
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: (profileId: string) => profileService.deleteProfile(profileId, oxyServices, activeSessionId || undefined),
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
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: ({ 
      profileId, 
      memberOxyUserId, 
      role 
    }: { 
      profileId: string; 
      memberOxyUserId: string; 
      role: 'owner' | 'admin' | 'agent' | 'viewer' 
    }) => profileService.addAgencyMember(profileId, memberOxyUserId, role, oxyServices, activeSessionId || undefined),
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
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: ({ 
      profileId, 
      memberOxyUserId 
    }: { 
      profileId: string; 
      memberOxyUserId: string; 
    }) => profileService.removeAgencyMember(profileId, memberOxyUserId, oxyServices, activeSessionId || undefined),
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
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: ({ 
      profileId, 
      factor, 
      value 
    }: { 
      profileId: string; 
      factor: string; 
      value: number; 
    }) => profileService.updateTrustScore(profileId, factor, value, oxyServices, activeSessionId || undefined),
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

// Hook to get the currently active profile
export function useActiveProfile() {
  const { data: profiles, isLoading, error, refetch } = useUserProfiles();
  
  const activeProfile = profiles?.find(p => p.isActive);
  
  return {
    data: activeProfile || null,
    isLoading,
    error,
    refetch,
    profiles // Also return all profiles in case they're needed
  };
} 