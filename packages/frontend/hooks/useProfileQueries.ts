import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import profileService, { 
  Profile, 
  CreateProfileData, 
  UpdateProfileData 
} from '@/services/profileService';
import { toast } from 'sonner';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/store/store';
import { useCallback, useEffect } from 'react';
import { 
  createProfile as createProfileAction, 
  updateProfile as updateProfileAction, 
  deleteProfile as deleteProfileAction, 
  activateProfile as activateProfileAction,
  fetchUserProfiles,
  fetchPrimaryProfile
} from '@/store/reducers/profileReducer';

// Query keys
const profileKeys = {
  all: ['profiles'] as const,
  lists: () => [...profileKeys.all, 'list'] as const,
  list: (filters: string) => [...profileKeys.lists(), { filters }] as const,
  details: () => [...profileKeys.all, 'detail'] as const,
  detail: (id: string) => [...profileKeys.details(), id] as const,
  byType: (type: string) => [...profileKeys.all, 'type', type] as const,
  byId: (id: string) => [...profileKeys.all, 'id', id] as const,
};

// Hook to get user profiles
export function useUserProfiles() {
  const { oxyServices, activeSessionId } = useOxy();
  return useQuery<Profile[]>({
    queryKey: profileKeys.lists(),
    queryFn: async () => {
      return await profileService.getUserProfiles(oxyServices, activeSessionId || undefined);
    },
    enabled: !!oxyServices && !!activeSessionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

// Hook to get profile by type
export function useProfileByType(profileType: 'personal' | 'agency' | 'business') {
  const { oxyServices, activeSessionId } = useOxy();
  return useQuery<Profile>({
    queryKey: profileKeys.byType(profileType),
    queryFn: async () => {
      return await profileService.getProfileByType(profileType, oxyServices, activeSessionId || undefined);
    },
    enabled: !!oxyServices && !!activeSessionId && !!profileType,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

// Hook to create a profile
export function useCreateProfile() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();
  
  return useMutation<Profile, Error, CreateProfileData>({
    mutationFn: async (profileData: CreateProfileData) => {
      // Check if trying to create a personal profile
      if (profileData.profileType === 'personal') {
        throw new Error('Personal profiles cannot be created manually. They are created automatically when you first access the system.');
      }
      
      return await profileService.createProfile(profileData, oxyServices, activeSessionId || undefined);
    },
    onSuccess: () => {
      // Invalidate and refetch profiles
      queryClient.invalidateQueries({ queryKey: profileKeys.lists() });
      toast.success('Profile created successfully');
    },
    onError: (error) => {
      console.error('Error creating profile:', error);
      toast.error(error.message || 'Failed to create profile');
    },
  });
}

// Hook to update a profile
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();
  
  return useMutation<Profile, Error, { profileId: string; updateData: UpdateProfileData }>({
    mutationFn: async ({ profileId, updateData }) => {
      return await profileService.updateProfile(profileId, updateData, oxyServices, activeSessionId || undefined);
    },
    onSuccess: (updatedProfile) => {
      // Update the specific profile in cache
      queryClient.setQueryData(profileKeys.detail(updatedProfile.id || updatedProfile._id || ''), updatedProfile);
      queryClient.invalidateQueries({ queryKey: profileKeys.lists() });
      toast.success('Profile updated successfully');
    },
    onError: (error) => {
      console.error('Error updating profile:', error);
      toast.error(error.message || 'Failed to update profile');
    },
  });
}

// Hook to delete a profile
export function useDeleteProfile() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();
  
  return useMutation<void, Error, string>({
    mutationFn: async (profileId: string) => {
      return await profileService.deleteProfile(profileId, oxyServices, activeSessionId || undefined);
    },
    onSuccess: () => {
      // Invalidate and refetch profiles
      queryClient.invalidateQueries({ queryKey: profileKeys.lists() });
      toast.success('Profile deleted successfully');
    },
    onError: (error) => {
      console.error('Error deleting profile:', error);
      toast.error(error.message || 'Failed to delete profile');
    },
  });
}

// Hook to get the currently active profile with full data
export function useActiveProfile() {
  const { data: profiles, isLoading: profilesLoading, error: profilesError } = useUserProfiles();
  
  // Find the active profile from the profiles list (this gives us basic info)
  const activeProfileBasic = profiles?.find(p => p.isActive) || profiles?.[0] || null;
  
  // Get the full profile data by type if we have an active profile
  const profileType = activeProfileBasic?.profileType as 'personal' | 'agency' | 'business' || 'personal';
  const { data: fullProfile, isLoading: fullProfileLoading, error: fullProfileError } = useProfileByType(profileType);
  
  // Use the full profile if available and matches the active profile, otherwise fall back to basic profile
  const activeProfile = (activeProfileBasic && fullProfile && fullProfile.id === activeProfileBasic.id) 
    ? fullProfile 
    : activeProfileBasic;
  
  // Debug logging
  console.log('useActiveProfile:', {
    profilesCount: profiles?.length || 0,
    hasActiveProfile: !!activeProfile,
    activeProfileId: activeProfile?.id,
    activeProfileType: activeProfile?.profileType,
    hasFullData: !!(activeProfile as any)?.personalProfile || !!(activeProfile as any)?.agencyProfile || !!(activeProfile as any)?.businessProfile,
    fullProfileId: fullProfile?.id,
    profilesMatch: fullProfile?.id === activeProfileBasic?.id,
    allProfiles: profiles?.map(p => ({ id: p.id, type: p.profileType, isActive: p.isActive, isPrimary: p.isPrimary }))
  });
  
  return {
    data: activeProfile,
    isLoading: profilesLoading || (activeProfileBasic ? fullProfileLoading : false),
    error: profilesError || fullProfileError,
    refetch: () => {
      // We don't have direct access to refetch from useUserProfiles here, 
      // but the queries will automatically refetch when needed
    },
    profiles // Also return all profiles in case they're needed
  };
}

// Hook to get profile by ID
export function useProfileById(profileId: string | undefined | null) {
  const { oxyServices, activeSessionId } = useOxy();
  return useQuery<Profile | null>({
    queryKey: profileKeys.byId(profileId || ''),
    queryFn: async () => {
      if (!profileId) return null;
      return await profileService.getProfileById(profileId, oxyServices, activeSessionId || undefined);
    },
    enabled: !!profileId && !!oxyServices && !!activeSessionId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

// Hook to use Redux for profile management
export function useProfileRedux() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  
  const { 
    primaryProfile, 
    allProfiles, 
    isLoading, 
    error 
  } = useSelector((state: RootState) => state.profile);

  // Auto-fetch profiles when component mounts and user is authenticated
  useEffect(() => {
    if (oxyServices && activeSessionId && allProfiles.length === 0 && !isLoading) {
      dispatch(fetchUserProfiles({ oxyServices, activeSessionId }));
      dispatch(fetchPrimaryProfile({ oxyServices, activeSessionId }));
    }
  }, [oxyServices, activeSessionId, allProfiles.length, isLoading, dispatch]);

  const createProfile = useCallback(async (profileData: any): Promise<Profile> => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('Authentication required');
    }
    
    return await dispatch(createProfileAction({ 
      profileData, 
      oxyServices, 
      activeSessionId 
    })).unwrap();
  }, [dispatch, oxyServices, activeSessionId]);

  const updateProfile = useCallback(async (profileId: string, updateData: any): Promise<Profile> => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('Authentication required');
    }
    
    return await dispatch(updateProfileAction({ 
      profileId, 
      updateData, 
      oxyServices, 
      activeSessionId 
    })).unwrap();
  }, [dispatch, oxyServices, activeSessionId]);

  const deleteProfile = useCallback(async (profileId: string): Promise<string> => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('Authentication required');
    }
    
    return await dispatch(deleteProfileAction({ 
      profileId, 
      oxyServices, 
      activeSessionId 
    })).unwrap();
  }, [dispatch, oxyServices, activeSessionId]);

  const activateProfile = useCallback(async (profileId: string): Promise<Profile> => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('Authentication required');
    }
    
    return await dispatch(activateProfileAction({ 
      profileId, 
      oxyServices, 
      activeSessionId 
    })).unwrap();
  }, [dispatch, oxyServices, activeSessionId]);

  const refetchProfiles = useCallback((): void => {
    if (oxyServices && activeSessionId) {
      dispatch(fetchUserProfiles({ oxyServices, activeSessionId }));
      dispatch(fetchPrimaryProfile({ oxyServices, activeSessionId }));
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    // State
    primaryProfile,
    allProfiles,
    isLoading,
    error,
    
    // Actions
    createProfile,
    updateProfile,
    deleteProfile,
    activateProfile,
    refetchProfiles,
  };
} 