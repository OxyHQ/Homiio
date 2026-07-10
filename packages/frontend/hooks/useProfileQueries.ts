import { useCallback, useEffect } from 'react';
import i18next from 'i18next';
import { useProfileStore } from '@/store/profileStore';
import { useOxy } from '@oxyhq/services';
import { toast } from '@/lib/sonner';
import type { UpdateProfileData } from '@homiio/shared-types';

export const useProfileRedux = () => {
  const { profile, isLoading, error, fetchProfile, updateProfile: storeUpdateProfile } = useProfileStore();
  const { oxyServices, activeSessionId } = useOxy();

  const refetchProfiles = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;
    await fetchProfile();
  }, [oxyServices, activeSessionId, fetchProfile]);

  const updateProfile = useCallback(
    async (profileData: UpdateProfileData) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }
      try {
        const updatedProfile = await storeUpdateProfile(profileData);
        toast.success(i18next.t('profile.toast.updateSuccess'));
        return updatedProfile;
      } catch (updateError: unknown) {
        const message = updateError instanceof Error ? updateError.message : i18next.t('profile.toast.updateFailed');
        toast.error(message);
        throw updateError;
      }
    },
    [oxyServices, activeSessionId, storeUpdateProfile],
  );

  useEffect(() => {
    refetchProfiles();
  }, [refetchProfiles]);

  return {
    profile,
    isLoading,
    error,
    refetchProfiles,
    updateProfile,
  };
};

export const useActiveProfile = () => {
  const { profile, isLoading, error } = useProfileStore();
  return { data: profile, isLoading, error };
};
