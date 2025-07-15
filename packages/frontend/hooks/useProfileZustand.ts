import { useCallback } from 'react';
import { useProfileStore } from '@/store/profileStore';
import { useOxy } from '@oxyhq/services';
import { Profile } from '@/services/profileService';

// Hook that provides the same interface as useProfileRedux but uses Zustand
export const useProfileZustand = () => {
  const { oxyServices, activeSessionId } = useOxy();
  
  const {
    primaryProfile,
    allProfiles,
    isLoading,
    error,
    fetchPrimaryProfile,
    fetchUserProfiles,
    updateProfile,
    createProfile,
    deleteProfile,
    activateProfile,
  } = useProfileStore();

  const refetchProfiles = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      console.log('OxyServices not available - cannot fetch profiles');
      return;
    }
    
    try {
      await fetchPrimaryProfile(oxyServices, activeSessionId);
      await fetchUserProfiles(oxyServices, activeSessionId);
    } catch (error) {
      console.error('Error refetching profiles:', error);
    }
  }, [oxyServices, activeSessionId, fetchPrimaryProfile, fetchUserProfiles]);

  return {
    profile: primaryProfile,
    allProfiles,
    primaryProfile,
    isLoading,
    error,
    refetchProfiles,
    updateProfile,
    createProfile,
    deleteProfile,
    activateProfile,
  };
}; 