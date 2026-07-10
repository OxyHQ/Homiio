import { useCallback } from 'react';
import i18next from 'i18next';
import { useProfileStore } from '@/store/profileStore';
import { Profile, UpdateProfileData } from '@/services/profileService';
import { useOxy } from '@oxyhq/services';
import { toast } from '@/lib/sonner';
import profileService from '@/services/profileService';

export const useProfileActions = () => {
  const { profile, isLoading, error, setProfile, setLoading, setError } = useProfileStore();
  const { oxyServices, activeSessionId } = useOxy();

  const loadProfile = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;

    try {
      setLoading(true);
      setError(null);
      const loaded = await profileService.getOrCreateProfile();
      setProfile(loaded);
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load profile';
      setError(message);
      toast.error(i18next.t('profile.toast.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, setLoading, setError, setProfile]);

  const updateProfile = useCallback(
    async (updateData: UpdateProfileData) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setLoading(true);
        setError(null);
        const updatedProfile = await profileService.updateMyProfile(updateData);
        setProfile(updatedProfile);
        toast.success(i18next.t('profile.toast.updateSuccess'));
        return updatedProfile;
      } catch (updateError: unknown) {
        const message = updateError instanceof Error ? updateError.message : 'Failed to update profile';
        setError(message);
        toast.error(i18next.t('profile.toast.updateFailed'));
        throw updateError;
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, setLoading, setError, setProfile],
  );

  return {
    profile,
    isLoading,
    error,
    loadProfile,
    updateProfile,
  };
};
