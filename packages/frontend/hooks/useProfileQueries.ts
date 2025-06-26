import { useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/store/store';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
import profileService, { 
  Profile, 
  CreateProfileData, 
  UpdateProfileData 
} from '@/services/profileService';
import { 
  createProfile as createProfileAction, 
  updateProfile as updateProfileAction, 
  deleteProfile as deleteProfileAction, 
  activateProfile as activateProfileAction,
  fetchUserProfiles,
  fetchPrimaryProfile
} from '@/store/reducers/profileReducer';

// Hook to get user profiles
export function useUserProfiles() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { allProfiles, isLoading, error } = useSelector((state: RootState) => state.profile);

  const refetch = useCallback(() => {
    if (oxyServices && activeSessionId) {
      dispatch(fetchUserProfiles({ oxyServices, activeSessionId }));
    }
  }, [dispatch, oxyServices, activeSessionId]);

  useEffect(() => {
    if (oxyServices && activeSessionId) {
      dispatch(fetchUserProfiles({ oxyServices, activeSessionId }));
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    data: allProfiles,
    isLoading,
    error,
    refetch,
  };
}

// Hook to get profile by type
export function useProfileByType(profileType: 'personal' | 'agency' | 'business') {
  const { allProfiles, isLoading, error } = useSelector((state: RootState) => state.profile);
  
  const profile = allProfiles?.find(p => p.profileType === profileType);
  
  return {
    data: profile || null,
    isLoading,
    error,
  };
}

// Hook to create a profile
export function useCreateProfile() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { isLoading } = useSelector((state: RootState) => state.profile);

  const createProfile = useCallback(async (profileData: CreateProfileData) => {
    // Check if trying to create a personal profile
    if (profileData.profileType === 'personal') {
      throw new Error('Personal profiles cannot be created manually. They are created automatically when you first access the system.');
    }
    
    try {
      const result = await dispatch(createProfileAction({ profileData, oxyServices, activeSessionId: activeSessionId || '' }));
      toast.success('Profile created successfully');
      return result;
    } catch (error: any) {
      console.error('Error creating profile:', error);
      toast.error(error.message || 'Failed to create profile');
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    createProfile,
    isLoading,
  };
}

// Hook to update a profile
export function useUpdateProfile() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { isLoading } = useSelector((state: RootState) => state.profile);

  const updateProfile = useCallback(async ({ profileId, updateData }: { profileId: string; updateData: UpdateProfileData }) => {
    try {
      const result = await dispatch(updateProfileAction({ profileId, updateData, oxyServices, activeSessionId: activeSessionId || '' }));
      toast.success('Profile updated successfully');
      return result;
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast.error(error.message || 'Failed to update profile');
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    updateProfile,
    isLoading,
  };
}

// Hook to delete a profile
export function useDeleteProfile() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { isLoading } = useSelector((state: RootState) => state.profile);

  const deleteProfile = useCallback(async (profileId: string) => {
    try {
      await dispatch(deleteProfileAction({ profileId, oxyServices, activeSessionId: activeSessionId || '' }));
      toast.success('Profile deleted successfully');
    } catch (error: any) {
      console.error('Error deleting profile:', error);
      toast.error(error.message || 'Failed to delete profile');
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    deleteProfile,
    isLoading,
  };
}

// Hook to get the currently active profile with full data
export function useActiveProfile() {
  const { allProfiles, primaryProfile, isLoading, error } = useSelector((state: RootState) => state.profile);
  
  // Find the active profile from the profiles list
  const activeProfile = allProfiles?.find(p => p.isActive) || primaryProfile || allProfiles?.[0] || null;
  
  return {
    data: activeProfile,
    isLoading,
    error,
    refetch: () => {
      // This would trigger a refetch if needed
    },
    profiles: allProfiles // Also return all profiles in case they're needed
  };
}

// Hook to get profile by ID
export function useProfileById(profileId: string | undefined | null) {
  const { allProfiles, isLoading, error } = useSelector((state: RootState) => state.profile);
  
  const profile = profileId ? allProfiles?.find(p => p.id === profileId || p._id === profileId) : null;
  
  return {
    data: profile || null,
    isLoading,
    error,
  };
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

  const loadProfiles = useCallback(() => {
    if (oxyServices && activeSessionId) {
      dispatch(fetchUserProfiles({ oxyServices, activeSessionId }));
    }
  }, [dispatch, oxyServices, activeSessionId]);

  const loadPrimaryProfile = useCallback(() => {
    if (oxyServices && activeSessionId) {
      dispatch(fetchPrimaryProfile({ oxyServices, activeSessionId }));
    }
  }, [dispatch, oxyServices, activeSessionId]);

  const createProfile = useCallback(async (profileData: CreateProfileData) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }
    
    try {
      const result = await dispatch(createProfileAction({ profileData, oxyServices, activeSessionId }));
      return result;
    } catch (error) {
      console.error('Error creating profile:', error);
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  const updateProfile = useCallback(async (profileId: string, updateData: UpdateProfileData) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }
    
    try {
      const result = await dispatch(updateProfileAction({ profileId, updateData, oxyServices, activeSessionId }));
      return result;
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  const deleteProfile = useCallback(async (profileId: string) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }
    
    try {
      await dispatch(deleteProfileAction({ profileId, oxyServices, activeSessionId }));
    } catch (error) {
      console.error('Error deleting profile:', error);
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  const activateProfile = useCallback(async (profileId: string) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }
    
    try {
      await dispatch(activateProfileAction({ profileId, oxyServices, activeSessionId }));
    } catch (error) {
      console.error('Error activating profile:', error);
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    primaryProfile,
    allProfiles,
    isLoading,
    error,
    loadProfiles,
    loadPrimaryProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    activateProfile,
  };
} 