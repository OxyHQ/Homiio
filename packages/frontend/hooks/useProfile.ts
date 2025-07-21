import { useCallback } from 'react';
import { useProfileStore } from '@/store/profileStore';
import { Profile, CreateProfileData } from '@/services/profileService';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';

export const useProfile = () => {
  const { primaryProfile, allProfiles, isLoading, error } = useProfileStore();
  const { setPrimaryProfile, setAllProfiles, setLoading, setError, fetchPrimaryProfile, fetchUserProfiles, createProfile: storeCreateProfile, updateProfile: storeUpdateProfile, deleteProfile: storeDeleteProfile } = useProfileStore();
  const { oxyServices, activeSessionId } = useOxy();

  const loadProfiles = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      await fetchPrimaryProfile(oxyServices, activeSessionId);
      await fetchUserProfiles(oxyServices, activeSessionId);
    } catch (error: any) {
      setError(error.message || 'Failed to load profiles');
      toast.error('Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }, [fetchPrimaryProfile, fetchUserProfiles, setLoading, setError, oxyServices, activeSessionId]);

  const createProfile = useCallback(async (profileData: CreateProfileData) => {
    if (!oxyServices || !activeSessionId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const newProfile = await storeCreateProfile(profileData, oxyServices, activeSessionId);
      
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
  }, [storeCreateProfile, setPrimaryProfile, setLoading, setError, oxyServices, activeSessionId]);

  const updateProfile = useCallback(async (profileId: string, updates: Partial<Profile>) => {
    if (!oxyServices || !activeSessionId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const updatedProfile = await storeUpdateProfile(profileId, updates as any, oxyServices, activeSessionId);
      
      if (primaryProfile?.id === profileId || primaryProfile?._id === profileId) {
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
  }, [primaryProfile, storeUpdateProfile, setPrimaryProfile, setLoading, setError, oxyServices, activeSessionId]);

  const deleteProfile = useCallback(async (profileId: string) => {
    if (!oxyServices || !activeSessionId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      await storeDeleteProfile(profileId, oxyServices, activeSessionId);
      
      if (primaryProfile?.id === profileId || primaryProfile?._id === profileId) {
        const remainingProfiles = allProfiles.filter(p => p.id !== profileId && p._id !== profileId);
        setPrimaryProfile(remainingProfiles.length > 0 ? remainingProfiles[0] : null);
      }
      toast.success('Profile deleted successfully');
    } catch (error: any) {
      setError(error.message || 'Failed to delete profile');
      toast.error('Failed to delete profile');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [primaryProfile, allProfiles, storeDeleteProfile, setPrimaryProfile, setLoading, setError, oxyServices, activeSessionId]);

  return {
    primaryProfile,
    allProfiles,
    isLoading,
    error,
    loadProfiles,
    createProfile,
    updateProfile,
    deleteProfile
  };
}; 