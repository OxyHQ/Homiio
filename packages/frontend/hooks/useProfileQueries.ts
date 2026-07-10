import { useCallback, useEffect } from 'react';
import i18next from 'i18next';
import { useProfileStore } from '@/store/profileStore';
import { useOxy } from '@oxyhq/services';
import { toast } from '@/lib/sonner';
import { ProfileType, type UpdateProfileData } from '@homiio/shared-types';

// Profile Zustand Hook
export const useProfileRedux = () => {
  const { primaryProfile, allProfiles, isLoading, error } = useProfileStore();
  const { setPrimaryProfile, setAllProfiles, setLoading, setError } = useProfileStore();
  const { oxyServices, activeSessionId } = useOxy();

  const fetchProfile = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use the profile store's async action
      await useProfileStore.getState().fetchPrimaryProfile();
    } catch (error: any) {
      setError(error.message || 'Failed to fetch profile');
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, setPrimaryProfile, setAllProfiles, setLoading, setError]);

  const updateProfile = useCallback(
    async (profileData: UpdateProfileData) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      const profileId = primaryProfile?.id || primaryProfile?._id;
      if (!profileId) {
        throw new Error('No primary profile to update');
      }

      try {
        // Use the profile store's async action for the primary profile
        const updatedProfile = await useProfileStore
          .getState()
          .updateProfile(profileId, profileData);

        toast.success(i18next.t('profile.toast.updateSuccess'));
        return updatedProfile;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : i18next.t('profile.toast.updateFailed');
        toast.error(message);
        throw error;
      }
    },
    [oxyServices, activeSessionId, primaryProfile],
  );

  const createProfile = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      // Use the profile store's async action
      const profile = await useProfileStore
        .getState()
        .createProfile({ profileType: ProfileType.PERSONAL });

      toast.success(i18next.t('profile.toast.createSuccess'));
      return profile;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : i18next.t('profile.toast.createFailed');
      toast.error(message);
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
