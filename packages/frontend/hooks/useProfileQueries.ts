import { useCallback, useEffect, useState } from 'react';
import { useProfileStore } from '@/store/profileStore';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
import type { UserProfile } from '@/utils/api';

// Profile Zustand Hook
export const useProfileRedux = () => {
  const { primaryProfile, allProfiles, isLoading, error } = useProfileStore();
  const { setPrimaryProfile, setAllProfiles, setLoading, setError } = useProfileStore();
  const { oxyServices, activeSessionId } = useOxy();

  const fetchProfile = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      console.log('OxyServices not available - cannot fetch profile');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use the profile store's async action
      const profile = await useProfileStore
        .getState()
        .fetchPrimaryProfile(oxyServices, activeSessionId);
      console.log('Successfully fetched user profile');
    } catch (error: any) {
      console.error('Error fetching profile:', error);
      setError(error.message || 'Failed to fetch profile');
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, setPrimaryProfile, setAllProfiles, setLoading, setError]);

  const updateProfile = useCallback(
    async (profileData: Partial<UserProfile>) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      try {
        // Use the profile store's async action for primary profile
        const updatedProfile = await useProfileStore
          .getState()
          .updatePrimaryProfile(profileData as any, oxyServices, activeSessionId);

        toast.success('Profile updated successfully');
        return updatedProfile;
      } catch (error: any) {
        console.error('Error updating profile:', error);
        toast.error(error.message || 'Failed to update profile');
        throw error;
      }
    },
    [oxyServices, activeSessionId],
  );

  const createProfile = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      // Use the profile store's async action
      const profile = await useProfileStore
        .getState()
        .createProfile({ profileType: 'personal' }, oxyServices, activeSessionId);

      toast.success('Profile created successfully');
      return profile;
    } catch (error: any) {
      console.error('Error creating profile:', error);
      toast.error(error.message || 'Failed to create profile');
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  // Load profile on mount
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    profile: primaryProfile,
    allProfiles,
    primaryProfile,
    isLoading,
    error,
    refetchProfiles: fetchProfile,
    updateProfile,
    createProfile,
    deleteProfile: () => Promise.reject(new Error('Profile deletion not supported')),
    activateProfile: () => Promise.reject(new Error('Profile activation not supported')),
  };
};

// Hook to get the active profile
export const useActiveProfile = () => {
  const { primaryProfile, isLoading, error } = useProfileStore();

  return {
    data: primaryProfile,
    isLoading,
    error,
  };
};
