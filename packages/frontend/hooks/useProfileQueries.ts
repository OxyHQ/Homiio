import { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
import type { UserProfile } from '@/utils/api';

// Profile Redux Hook
export const useProfileRedux = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      console.log('OxyServices not available - cannot fetch profile');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Import the API function
      const { profileApi } = await import('@/utils/api');
      const response = await profileApi.getUserProfile(oxyServices, activeSessionId);
      
      setProfile(response.data || null);
      console.log('Successfully fetched user profile');
    } catch (error: any) {
      console.error('Error fetching profile:', error);
      setError(error.message || 'Failed to fetch profile');
    } finally {
      setIsLoading(false);
    }
  }, [oxyServices, activeSessionId]);

  const updateProfile = useCallback(async (profileData: Partial<UserProfile>) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      const { profileApi } = await import('@/utils/api');
      const response = await profileApi.updateUserProfile(profileData, oxyServices, activeSessionId);
      
      // Update local state
      setProfile(prev => prev ? { ...prev, ...response.data } : response.data || null);
      
      toast.success('Profile updated successfully');
      return response.data;
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast.error(error.message || 'Failed to update profile');
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  const createProfile = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      const { profileApi } = await import('@/utils/api');
      const response = await profileApi.createPersonalProfile(oxyServices, activeSessionId);
      
      setProfile(response.data || null);
      toast.success('Profile created successfully');
      return response.data;
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
    profile,
    allProfiles: profile ? [profile] : [],
    primaryProfile: profile,
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
  const { profile, isLoading, error } = useProfileRedux();
  
  return {
    data: profile,
    isLoading,
    error,
  };
}; 