import { useCallback } from 'react';
import i18next from 'i18next';
import { useProfileStore } from '@/store/profileStore';
import { Profile, CreateProfileData } from '@/services/profileService';
import { useOxy } from '@oxyhq/services';
import { toast } from '@/lib/sonner';
import profileService from '@/services/profileService';

export const useProfile = () => {
  const { primaryProfile, allProfiles, isLoading, error } = useProfileStore();
  const { setPrimaryProfile, setAllProfiles, setLoading, setError } = useProfileStore();
  const { oxyServices, activeSessionId } = useOxy();

  const loadProfiles = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;

    try {
      setLoading(true);
      setError(null);

      const [primaryProfile, allProfiles] = await Promise.all([
        profileService.getOrCreatePrimaryProfile(),
        profileService.getUserProfiles(),
      ]);

      setPrimaryProfile(primaryProfile);
      setAllProfiles(allProfiles || []);
    } catch (error: any) {
      setError(error.message || 'Failed to load profiles');
      toast.error(i18next.t('profile.toast.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, setLoading, setError, setPrimaryProfile, setAllProfiles]);

  const createProfile = useCallback(
    async (profileData: CreateProfileData) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setLoading(true);
        setError(null);

        const newProfile = await profileService.createProfile(profileData);

        setAllProfiles([...allProfiles, newProfile]);
        if (newProfile.isPrimary) {
          setPrimaryProfile(newProfile);
        }

        toast.success(i18next.t('profile.toast.createSuccess'));
        return newProfile;
      } catch (error: any) {
        setError(error.message || 'Failed to create profile');
        toast.error(i18next.t('profile.toast.createFailed'));
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [
      oxyServices,
      activeSessionId,
      setLoading,
      setError,
      setAllProfiles,
      setPrimaryProfile,
      allProfiles,
    ],
  );

  const updateProfile = useCallback(
    async (profileId: string, updateData: any) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setLoading(true);
        setError(null);

        const updatedProfile = await profileService.updateProfile(profileId, updateData);

        const updatedProfiles = allProfiles.map((p: Profile) =>
          p.id === profileId || p._id === profileId ? updatedProfile : p,
        );
        setAllProfiles(updatedProfiles);
        if (updatedProfile.isPrimary) {
          setPrimaryProfile(updatedProfile);
        }

        toast.success(i18next.t('profile.toast.updateSuccess'));
        return updatedProfile;
      } catch (error: any) {
        setError(error.message || 'Failed to update profile');
        toast.error(i18next.t('profile.toast.updateFailed'));
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [
      oxyServices,
      activeSessionId,
      setLoading,
      setError,
      setAllProfiles,
      setPrimaryProfile,
      allProfiles,
    ],
  );

  const deleteProfile = useCallback(
    async (profileId: string) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setLoading(true);
        setError(null);

        await profileService.deleteProfile(profileId);

        const filteredProfiles = allProfiles.filter(
          (p: Profile) => p.id !== profileId && p._id !== profileId,
        );
        setAllProfiles(filteredProfiles);
        if (primaryProfile?.id === profileId || primaryProfile?._id === profileId) {
          setPrimaryProfile(null);
        }

        toast.success(i18next.t('profile.toast.deleteSuccess'));
      } catch (error: any) {
        setError(error.message || 'Failed to delete profile');
        toast.error(i18next.t('profile.toast.deleteFailed'));
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [
      oxyServices,
      activeSessionId,
      setLoading,
      setError,
      setAllProfiles,
      setPrimaryProfile,
      primaryProfile,
      allProfiles,
    ],
  );

  const activateProfile = useCallback(
    async (profileId: string) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setLoading(true);
        setError(null);

        const activatedProfile = await profileService.activateProfile(profileId);

        // Update all profiles - deactivate others and activate the selected one
        const updatedProfiles = allProfiles.map((p: Profile) => ({
          ...p,
          isActive: p.id === profileId || p._id === profileId,
        }));

        setAllProfiles(updatedProfiles);
        setPrimaryProfile(activatedProfile);

        toast.success(i18next.t('profile.toast.activateSuccess'));
        return activatedProfile;
      } catch (error: any) {
        setError(error.message || 'Failed to activate profile');
        toast.error(i18next.t('profile.toast.activateFailed'));
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [
      oxyServices,
      activeSessionId,
      setLoading,
      setError,
      setAllProfiles,
      setPrimaryProfile,
      allProfiles,
    ],
  );

  return {
    primaryProfile,
    allProfiles,
    isLoading,
    error,
    loadProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    activateProfile,
  };
};
