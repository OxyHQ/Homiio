import { useCallback } from 'react';
import { useProfileStore } from '@/store/profileStore';
import { Profile, CreateProfileData } from '@/services/profileService';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
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
        profileService.getOrCreatePrimaryProfile(oxyServices, activeSessionId),
        profileService.getUserProfiles(oxyServices, activeSessionId),
      ]);

      setPrimaryProfile(primaryProfile);
      setAllProfiles(allProfiles || []);
    } catch (error: any) {
      setError(error.message || 'Failed to load profiles');
      toast.error('Failed to load profiles');
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

        const newProfile = await profileService.createProfile(
          profileData,
          oxyServices,
          activeSessionId,
        );

        setAllProfiles([...allProfiles, newProfile]);
        if (newProfile.isPrimary) {
          setPrimaryProfile(newProfile);
        }

        toast.success('Profile created successfully');
        return newProfile;
      } catch (error: any) {
        setError(error.message || 'Failed to create profile');
        toast.error('Failed to create profile');
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

        const updatedProfile = await profileService.updateProfile(
          profileId,
          updateData,
          oxyServices,
          activeSessionId,
        );

        const updatedProfiles = allProfiles.map((p: Profile) =>
          p.id === profileId || p._id === profileId ? updatedProfile : p,
        );
        setAllProfiles(updatedProfiles);
        if (updatedProfile.isPrimary) {
          setPrimaryProfile(updatedProfile);
        }

        toast.success('Profile updated successfully');
        return updatedProfile;
      } catch (error: any) {
        setError(error.message || 'Failed to update profile');
        toast.error('Failed to update profile');
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

        await profileService.deleteProfile(profileId, oxyServices, activeSessionId);

        const filteredProfiles = allProfiles.filter(
          (p: Profile) => p.id !== profileId && p._id !== profileId,
        );
        setAllProfiles(filteredProfiles);
        if (primaryProfile?.id === profileId || primaryProfile?._id === profileId) {
          setPrimaryProfile(null);
        }

        toast.success('Profile deleted successfully');
      } catch (error: any) {
        setError(error.message || 'Failed to delete profile');
        toast.error('Failed to delete profile');
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

        const activatedProfile = await profileService.activateProfile(
          profileId,
          oxyServices,
          activeSessionId,
        );

        // Update all profiles - deactivate others and activate the selected one
        const updatedProfiles = allProfiles.map((p: Profile) => ({
          ...p,
          isActive: p.id === profileId || p._id === profileId,
        }));

        setAllProfiles(updatedProfiles);
        setPrimaryProfile(activatedProfile);

        toast.success('Profile activated successfully');
        return activatedProfile;
      } catch (error: any) {
        setError(error.message || 'Failed to activate profile');
        toast.error('Failed to activate profile');
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
