import { useCallback, useEffect } from 'react';
import { useProfileStore } from '@/store/profileStore';
import { useAuth } from '@oxyhq/services';
import { toast } from '@/lib/sonner';
import type { UpdateProfileData } from '@homiio/shared-types';

export const useProfileRedux = () => {
  const { profile, isLoading, error, fetchProfile, updateProfile: storeUpdate } = useProfileStore();
  const { isAuthenticated } = useAuth();

  const fetchProfileSafe = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      await fetchProfile();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch profile';
      toast.error(message);
    }
  }, [isAuthenticated, fetchProfile]);

  const updateProfile = useCallback(
    async (profileData: UpdateProfileData) => {
      const profileId = profile?.id || profile?._id;
      if (!profileId) throw new Error('No profile to update');
      const updated = await storeUpdate(profileId, profileData);
      toast.success('Profile updated successfully');
      return updated;
    },
    [profile, storeUpdate],
  );

  useEffect(() => {
    fetchProfileSafe();
  }, [fetchProfileSafe]);

  return {
    profile,
    allProfiles: profile ? [profile] : [],
    primaryProfile: profile,
    isLoading,
    error,
    refetchProfiles: fetchProfileSafe,
    updateProfile,
    createProfile: () => Promise.reject(new Error('Use Oxy CreateAccount')),
    deleteProfile: () => Promise.reject(new Error('Profile deletion not supported')),
    activateProfile: () => Promise.reject(new Error('Use Oxy account switch')),
  };
};

export const useActiveProfile = () => {
  const { profile, isLoading, error } = useProfileStore();
  return { data: profile, isLoading, error };
};
