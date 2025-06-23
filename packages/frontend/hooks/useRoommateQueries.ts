import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile } = useActiveProfile();
  
  return useQuery<{ profiles: Profile[]; total: number; page: number; totalPages: number }>({
    queryKey: roommateKeys.list(filters),
    queryFn: async () => {
      if (!oxyServices || !activeSessionId) {
        console.log('OxyServices not available - returning empty roommate profiles');
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
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!(oxyServices && activeSessionId),
  });
}

// Hook to get current user's roommate preferences
export function useMyRoommatePreferences() {
  const { oxyServices, activeSessionId } = useOxy();
  
  return useQuery<RoommatePreferences | null>({
    queryKey: roommateKeys.preferences(),
    queryFn: async () => {
      if (!oxyServices || !activeSessionId) {
        console.log('OxyServices not available - returning null preferences');
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
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!(oxyServices && activeSessionId),
  });
}

// Hook to check if current profile has roommate matching enabled
export function useHasRoommateMatching() {
  const { data: activeProfile } = useActiveProfile();
  
  const hasRoommateMatching = activeProfile ? roommateService.hasRoommateMatchingEnabled(activeProfile) : false;
  
  return {
    hasRoommateMatching,
    activeProfile,
    roommatePreferences: activeProfile ? roommateService.getRoommatePreferencesFromProfile(activeProfile) : null,
  };
}

// Hook to update roommate preferences
export function useUpdateRoommatePreferences() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async (preferences: RoommatePreferences) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      try {
        console.log('Updating roommate preferences with OxyServices authentication');
        const updatedPreferences = await roommateService.updateRoommatePreferences(preferences, oxyServices, activeSessionId);
        console.log('Successfully updated roommate preferences:', updatedPreferences);
        return updatedPreferences;
      } catch (error) {
        console.error('Error updating roommate preferences:', error);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate roommate queries to refresh the data
      queryClient.invalidateQueries({ queryKey: roommateKeys.all() });
      toast.success('Roommate preferences updated successfully!');
    },
    onError: (error: any) => {
      console.error('Update roommate preferences mutation error:', error);
      toast.error('Failed to update roommate preferences', {
        description: error.message || 'Please try again.',
      });
    },
  });
}

// Hook to toggle roommate matching
export function useToggleRoommateMatching() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      try {
        console.log(`Toggling roommate matching to ${enabled} with OxyServices authentication`);
        await roommateService.toggleRoommateMatching(enabled, oxyServices, activeSessionId);
        console.log(`Successfully toggled roommate matching to ${enabled}`);
      } catch (error) {
        console.error('Error toggling roommate matching:', error);
        throw error;
      }
    },
    onSuccess: (_, enabled) => {
      // Invalidate profile and roommate queries to refresh the data
      queryClient.invalidateQueries({ queryKey: roommateKeys.all() });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      // Also invalidate specific profile queries that useActiveProfile depends on
      queryClient.invalidateQueries({ queryKey: ['profiles', 'user'] });
      queryClient.invalidateQueries({ queryKey: ['profiles', 'primary'] });
      queryClient.invalidateQueries({ queryKey: ['profiles', 'type', 'personal'] });
      queryClient.invalidateQueries({ queryKey: ['profiles', 'type', 'agency'] });
      queryClient.invalidateQueries({ queryKey: ['profiles', 'type', 'business'] });
      toast.success(`Roommate matching ${enabled ? 'enabled' : 'disabled'} successfully!`);
    },
    onError: (error: any) => {
      console.error('Toggle roommate matching mutation error:', error);
      toast.error('Failed to toggle roommate matching', {
        description: error.message || 'Please try again.',
      });
    },
  });
}

// Hook to send roommate request
export function useSendRoommateRequest() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async ({ profileId, message }: { profileId: string; message?: string }) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      try {
        console.log(`Sending roommate request to profile ${profileId} with OxyServices authentication`);
        await roommateService.sendRoommateRequest(profileId, message, oxyServices, activeSessionId);
        console.log(`Successfully sent roommate request to profile ${profileId}`);
      } catch (error) {
        console.error('Error sending roommate request:', error);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate roommate requests to refresh the data
      queryClient.invalidateQueries({ queryKey: roommateKeys.requests() });
      toast.success('Roommate request sent successfully!');
    },
    onError: (error: any) => {
      console.error('Send roommate request mutation error:', error);
      toast.error('Failed to send roommate request', {
        description: error.message || 'Please try again.',
      });
    },
  });
}

// Hook to get roommate requests
export function useRoommateRequests() {
  const { oxyServices, activeSessionId } = useOxy();
  
  return useQuery<{ sent: any[]; received: any[] }>({
    queryKey: roommateKeys.requests(),
    queryFn: async () => {
      if (!oxyServices || !activeSessionId) {
        console.log('OxyServices not available - returning empty roommate requests');
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
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!(oxyServices && activeSessionId),
  });
}

// Hook to accept roommate request
export function useAcceptRoommateRequest() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async (requestId: string) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      try {
        console.log(`Accepting roommate request ${requestId} with OxyServices authentication`);
        await roommateService.acceptRoommateRequest(requestId, oxyServices, activeSessionId);
        console.log(`Successfully accepted roommate request ${requestId}`);
      } catch (error) {
        console.error('Error accepting roommate request:', error);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate roommate requests to refresh the data
      queryClient.invalidateQueries({ queryKey: roommateKeys.requests() });
      toast.success('Roommate request accepted!');
    },
    onError: (error: any) => {
      console.error('Accept roommate request mutation error:', error);
      toast.error('Failed to accept roommate request', {
        description: error.message || 'Please try again.',
      });
    },
  });
}

// Hook to decline roommate request
export function useDeclineRoommateRequest() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async (requestId: string) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      try {
        console.log(`Declining roommate request ${requestId} with OxyServices authentication`);
        await roommateService.declineRoommateRequest(requestId, oxyServices, activeSessionId);
        console.log(`Successfully declined roommate request ${requestId}`);
      } catch (error) {
        console.error('Error declining roommate request:', error);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate roommate requests to refresh the data
      queryClient.invalidateQueries({ queryKey: roommateKeys.requests() });
      toast.success('Roommate request declined');
    },
    onError: (error: any) => {
      console.error('Decline roommate request mutation error:', error);
      toast.error('Failed to decline roommate request', {
        description: error.message || 'Please try again.',
      });
    },
  });
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