import { useCallback, useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
import { roommateService, RoommateFilters, RoommatePreferences } from '@/services/roommateService';
import { useActiveProfile } from './useProfileQueries';
import type { Profile } from '@/services/profileService';

// Roommate Redux Hook
export const useRoommateProfiles = (filters?: RoommateFilters) => {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      console.log('OxyServices not available - cannot fetch roommate profiles');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await roommateService.getRoommateProfiles(filters, oxyServices, activeSessionId);
      
      setProfiles(response.profiles || []);
      console.log('Successfully fetched roommate profiles');
    } catch (error: any) {
      console.error('Error fetching roommate profiles:', error);
      setError(error.message || 'Failed to fetch roommate profiles');
    } finally {
      setIsLoading(false);
    }
  }, [oxyServices, activeSessionId, filters]);

  // Load profiles on mount
  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  return {
    data: {
      profiles,
    },
    isLoading,
    error,
    refetch: fetchProfiles,
  };
};

// Hook to check if user has roommate matching enabled
export const useHasRoommateMatching = () => {
  const { data: profile } = useActiveProfile();
  
  return {
    hasRoommateMatching: profile ? roommateService.hasRoommateMatchingEnabled(profile as any) : false,
  };
};

// Hook to toggle roommate matching
export const useToggleRoommateMatching = () => {
  const { oxyServices, activeSessionId } = useOxy();
  
  const toggleMatching = useCallback(async (enabled: boolean) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      await roommateService.toggleRoommateMatching(enabled, oxyServices, activeSessionId);
      toast.success(`Roommate matching ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error: any) {
      console.error('Error toggling roommate matching:', error);
      toast.error(error.message || 'Failed to toggle roommate matching');
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    toggleMatching,
  };
};

// Hook to send roommate request
export const useSendRoommateRequest = () => {
  const { oxyServices, activeSessionId } = useOxy();
  
  const sendRequest = useCallback(async (profileId: string, message?: string) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      await roommateService.sendRoommateRequest(profileId, message, oxyServices, activeSessionId);
      toast.success('Roommate request sent successfully');
    } catch (error: any) {
      console.error('Error sending roommate request:', error);
      toast.error(error.message || 'Failed to send roommate request');
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    sendRequest,
  };
}; 