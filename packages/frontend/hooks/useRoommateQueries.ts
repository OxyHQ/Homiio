import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '@/store/store';
import { roommateService } from '@/services/roommateService';
import { useOxy } from '@oxyhq/services';
import { useActiveProfile } from '@/hooks/useProfileQueries';
import { toast } from 'sonner';
import type { Profile } from '@/services/profileService';
import type { RoommatePreferences, RoommateFilters } from '@/services/roommateService';

export const roommateKeys = {
  all: () => ['roommates'] as const,
  lists: () => [...roommateKeys.all(), 'list'] as const,
  list: (filters: any) => [...roommateKeys.lists(), filters] as const,
  preferences: () => [...roommateKeys.all(), 'preferences'] as const,
  requests: () => [...roommateKeys.all(), 'requests'] as const,
  profile: (profileId: string) => [...roommateKeys.all(), 'profile', profileId] as const,
};

// Hook to get available roommate profiles
export function useRoommateProfiles(filters?: RoommateFilters) {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile } = useActiveProfile();
  
  const fetchProfiles = useCallback(async () => {
    if (!oxyServices || !activeSessionId || !activeProfile) {
      return { profiles: [], total: 0, page: 1, totalPages: 1 };
    }

    try {
      console.log('Fetching roommate profiles with OxyServices authentication');
      const response = await roommateService.getRoommateProfiles(filters, oxyServices, activeSessionId);
      console.log(`Successfully fetched ${response.profiles.length} roommate profiles`);
      return response;
    } catch (error) {
      console.error('Error fetching roommate profiles:', error);
      return { profiles: [], total: 0, page: 1, totalPages: 1 };
    }
  }, [oxyServices, activeSessionId, activeProfile, filters]);

  return {
    data: { profiles: [], total: 0, page: 1, totalPages: 1 },
    isLoading: false,
    error: null,
    refetch: fetchProfiles,
  };
}

// Hook to get roommate matches
export function useRoommateMatches(filters?: RoommateFilters) {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile } = useActiveProfile();
  
  const fetchRoommateMatches = useCallback(async () => {
    if (!oxyServices || !activeSessionId || !activeProfile) {
      return [];
    }

    try {
      console.log('Fetching roommate matches with OxyServices authentication');
      // Use getRoommateProfiles as a fallback since getMyRoommateMatches doesn't exist
      const response = await roommateService.getRoommateProfiles(filters, oxyServices, activeSessionId);
      console.log(`Successfully fetched ${response.profiles.length} roommate matches`);
      return response.profiles;
    } catch (error) {
      console.error('Error fetching roommate matches:', error);
      return [];
    }
  }, [oxyServices, activeSessionId, activeProfile, filters]);

  return {
    data: [],
    isLoading: false,
    error: null,
    refetch: fetchRoommateMatches,
  };
}

// Hook to get roommate preferences
export function useRoommatePreferences() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile } = useActiveProfile();
  
  const fetchPreferences = useCallback(async () => {
    if (!oxyServices || !activeSessionId || !activeProfile) {
      return null;
    }

    try {
      console.log('Fetching roommate preferences with OxyServices authentication');
      const preferences = await roommateService.getMyRoommatePreferences(oxyServices, activeSessionId);
      console.log('Successfully fetched roommate preferences:', preferences);
      return preferences;
    } catch (error) {
      console.error('Error fetching roommate preferences:', error);
      return null;
    }
  }, [oxyServices, activeSessionId, activeProfile]);

  return {
    data: null,
    isLoading: false,
    error: null,
    refetch: fetchPreferences,
  };
}

// Hook to check if user has roommate matching enabled
export function useHasRoommateMatching() {
  const { data: activeProfile } = useActiveProfile();
  
  return {
    hasRoommateMatching: roommateService.hasRoommateMatchingEnabled(activeProfile || {} as Profile),
  };
}

// Hook to update roommate preferences
export function useUpdateRoommatePreferences() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();

  const updatePreferences = useCallback(async (preferences: RoommatePreferences) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      console.log('Updating roommate preferences with OxyServices authentication');
      const updatedPreferences = await roommateService.updateRoommatePreferences(preferences, oxyServices, activeSessionId);
      console.log('Successfully updated roommate preferences:', updatedPreferences);
      
      toast.success('Roommate preferences updated successfully!');
      return updatedPreferences;
    } catch (error: any) {
      console.error('Error updating roommate preferences:', error);
      toast.error('Failed to update roommate preferences', {
        description: error.message || 'Please try again.',
      });
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    updatePreferences,
    isLoading: false,
  };
}

// Hook to toggle roommate matching
export function useToggleRoommateMatching() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();

  const toggleMatching = useCallback(async (enabled: boolean) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      console.log(`Toggling roommate matching to ${enabled} with OxyServices authentication`);
      await roommateService.toggleRoommateMatching(enabled, oxyServices, activeSessionId);
      console.log(`Successfully toggled roommate matching to ${enabled}`);
      
      toast.success(`Roommate matching ${enabled ? 'enabled' : 'disabled'} successfully!`);
    } catch (error: any) {
      console.error('Error toggling roommate matching:', error);
      toast.error('Failed to toggle roommate matching', {
        description: error.message || 'Please try again.',
      });
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    toggleMatching,
    isLoading: false,
  };
}

// Hook to send roommate request
export function useSendRoommateRequest() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();

  const sendRequest = useCallback(async ({ profileId, message }: { profileId: string; message?: string }) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      console.log(`Sending roommate request to profile ${profileId} with OxyServices authentication`);
      await roommateService.sendRoommateRequest(profileId, message, oxyServices, activeSessionId);
      console.log(`Successfully sent roommate request to profile ${profileId}`);
      
      toast.success('Roommate request sent successfully!');
    } catch (error: any) {
      console.error('Error sending roommate request:', error);
      toast.error('Failed to send roommate request', {
        description: error.message || 'Please try again.',
      });
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    sendRequest,
    isLoading: false,
  };
}

// Hook to get roommate requests
export function useRoommateRequests() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  
  const fetchRequests = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      return { sent: [], received: [] };
    }

    try {
      console.log('Fetching roommate requests with OxyServices authentication');
      const requests = await roommateService.getRoommateRequests(oxyServices, activeSessionId);
      console.log(`Successfully fetched roommate requests: ${requests.sent.length} sent, ${requests.received.length} received`);
      return requests;
    } catch (error) {
      console.error('Error fetching roommate requests:', error);
      return { sent: [], received: [] };
    }
  }, [oxyServices, activeSessionId]);

  return {
    data: { sent: [], received: [] },
    isLoading: false,
    error: null,
    refetch: fetchRequests,
  };
}

// Hook to accept roommate request
export function useAcceptRoommateRequest() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();

  const acceptRequest = useCallback(async (requestId: string) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      console.log(`Accepting roommate request ${requestId} with OxyServices authentication`);
      await roommateService.acceptRoommateRequest(requestId, oxyServices, activeSessionId);
      console.log(`Successfully accepted roommate request ${requestId}`);
      
      toast.success('Roommate request accepted!');
    } catch (error: any) {
      console.error('Error accepting roommate request:', error);
      toast.error('Failed to accept roommate request', {
        description: error.message || 'Please try again.',
      });
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    acceptRequest,
    isLoading: false,
  };
}

// Hook to decline roommate request
export function useDeclineRoommateRequest() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();

  const declineRequest = useCallback(async (requestId: string) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      console.log(`Declining roommate request ${requestId} with OxyServices authentication`);
      await roommateService.declineRoommateRequest(requestId, oxyServices, activeSessionId);
      console.log(`Successfully declined roommate request ${requestId}`);
      
      toast.success('Roommate request declined');
    } catch (error: any) {
      console.error('Error declining roommate request:', error);
      toast.error('Failed to decline roommate request', {
        description: error.message || 'Please try again.',
      });
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    declineRequest,
    isLoading: false,
  };
}

// Hook to calculate match percentage between current profile and another profile
export function useMatchPercentage(otherProfile: Profile | null) {
  const { data: activeProfile } = useActiveProfile();
  
  if (!activeProfile || !otherProfile) {
    return { matchPercentage: 0 };
  }
  
  const matchPercentage = roommateService.calculateMatchPercentage(activeProfile, otherProfile);
  
  return { matchPercentage };
} 