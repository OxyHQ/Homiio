import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { roommateService } from '@/services/roommateService';
import type { Profile } from '@/services/profileService';
import { useRoommateStore, useRoommateSelectors } from '@/store/roommateStore';
import { useOxy } from '@oxyhq/services';

export interface RoommateProfile extends Profile {
  matchScore?: number;
}

export interface RoommateRequest {
  id: string;
  senderProfileId: string;
  receiverProfileId: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  message?: string;
  matchScore: number;
  createdAt: string;
  sender: RoommateProfile;
  receiver: RoommateProfile;
}

export interface RoommateRelationship {
  id: string;
  profile1Id: string;
  profile2Id: string;
  status: 'active' | 'inactive' | 'ended';
  startDate: string;
  endDate?: string;
  matchScore: number;
  profile1: RoommateProfile;
  profile2: RoommateProfile;
}

export const useRoommate = () => {
  const { roommates: profiles, requests, relationships, isLoading, error } = useRoommateSelectors();
  const {
    setRoommates,
    setRequests,
    setRelationships,
    setLoading,
    setError,
    clearError: clearStoreError,
  } = useRoommateStore();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  // Queries (disabled by default; refetch on demand based on tab)
  const profilesQuery = useQuery({
    queryKey: ['roommates', 'profiles'],
    queryFn: async () => {
      const response = await roommateService.getRoommateProfiles(
        undefined,
        oxyServices!,
        activeSessionId!,
      );
      return response.profiles || [];
    },
    enabled: false,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
    onSuccess: (data) => {
      // Avoid setting store to an identical array reference to prevent re-renders
      setRoommates(Array.isArray(data) ? [...data] : []);
      setError(null);
    },
    onError: (err: any) => {
      setError(err?.message || 'Failed to fetch profiles');
    },
  });

  const requestsQuery = useQuery({
    queryKey: ['roommates', 'requests'],
    queryFn: async () => {
      const response = await roommateService.getRoommateRequests(oxyServices!, activeSessionId!);
      return response || { sent: [], received: [] };
    },
    enabled: false,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
    onSuccess: (data) => {
      const next = { sent: data.sent ?? [], received: data.received ?? [] };
      setRequests({ sent: [...next.sent], received: [...next.received] });
      setError(null);
    },
    onError: (err: any) => {
      setError(err?.message || 'Failed to fetch requests');
    },
  });

  const relationshipsQuery = useQuery({
    queryKey: ['roommates', 'relationships'],
    queryFn: async () => {
      const response = await roommateService.getRoommateRelationships(oxyServices!, activeSessionId!);
      return response.data || [];
    },
    enabled: false,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
    onSuccess: (data) => {
      setRelationships(Array.isArray(data) ? [...data] : []);
      setError(null);
    },
    onError: (err: any) => {
      setError(err?.message || 'Failed to fetch relationships');
    },
  });

  // Adapter functions to trigger refetch when requested by tabs/UI
  const fetchProfiles = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;
    setLoading(true);
    setError(null);
    try {
      await profilesQuery.refetch();
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, profilesQuery, setLoading, setError]);

  // Fetch roommate requests
  const fetchRequests = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;
    setLoading(true);
    setError(null);
    try {
      await requestsQuery.refetch();
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, requestsQuery, setLoading, setError]);

  // Fetch roommate relationships
  const fetchRelationships = useCallback(async () => {
    // Backend endpoint not available yet; avoid 404 noise and show empty state
    setRelationships([]);
    setError(null);
  }, [setRelationships, setError]);

  // Mutations
  const sendRequestMutation = useMutation({
    mutationKey: ['roommates', 'sendRequest'],
    mutationFn: async (vars: { profileId: string; message?: string }) => {
      await roommateService.sendRoommateRequest(
        vars.profileId,
        vars.message,
        oxyServices!,
        activeSessionId!,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roommates', 'requests'] });
      await requestsQuery.refetch();
    },
    onError: (err: any) => setError(err?.message || 'Failed to send request'),
  });

  const sendRequest = useCallback(
    async (profileId: string, message?: string) => {
      if (!oxyServices || !activeSessionId) return false;
      setLoading(true);
      setError(null);
      try {
        await sendRequestMutation.mutateAsync({ profileId, message });
        return true;
      } catch {
        return false;
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, sendRequestMutation, setLoading, setError],
  );

  // Accept roommate request
  const acceptRequestMutation = useMutation({
    mutationKey: ['roommates', 'acceptRequest'],
    mutationFn: async (vars: { requestId: string; responseMessage?: string }) => {
      await roommateService.acceptRoommateRequest(
        vars.requestId,
        vars.responseMessage,
        oxyServices!,
        activeSessionId!,
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['roommates', 'requests'] }),
        queryClient.invalidateQueries({ queryKey: ['roommates', 'relationships'] }),
      ]);
      await Promise.all([requestsQuery.refetch(), relationshipsQuery.refetch()]);
    },
    onError: (err: any) => setError(err?.message || 'Failed to accept request'),
  });

  const acceptRequest = useCallback(
    async (requestId: string, responseMessage?: string) => {
      if (!oxyServices || !activeSessionId) return false;
      setLoading(true);
      setError(null);
      try {
        await acceptRequestMutation.mutateAsync({ requestId, responseMessage });
        return true;
      } catch {
        return false;
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, acceptRequestMutation, setLoading, setError],
  );

  // Decline roommate request
  const declineRequestMutation = useMutation({
    mutationKey: ['roommates', 'declineRequest'],
    mutationFn: async (vars: { requestId: string; responseMessage?: string }) => {
      await roommateService.declineRoommateRequest(
        vars.requestId,
        vars.responseMessage,
        oxyServices!,
        activeSessionId!,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roommates', 'requests'] });
      await requestsQuery.refetch();
    },
    onError: (err: any) => setError(err?.message || 'Failed to decline request'),
  });

  const declineRequest = useCallback(
    async (requestId: string, responseMessage?: string) => {
      if (!oxyServices || !activeSessionId) return false;
      setLoading(true);
      setError(null);
      try {
        await declineRequestMutation.mutateAsync({ requestId, responseMessage });
        return true;
      } catch {
        return false;
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, declineRequestMutation, setLoading, setError],
  );

  // End roommate relationship
  const endRelationshipMutation = useMutation({
    mutationKey: ['roommates', 'endRelationship'],
    mutationFn: async (vars: { relationshipId: string }) => {
      await roommateService.endRoommateRelationship(
        vars.relationshipId,
        oxyServices!,
        activeSessionId!,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roommates', 'relationships'] });
      await relationshipsQuery.refetch();
    },
    onError: (err: any) => setError(err?.message || 'Failed to end relationship'),
  });

  const endRelationship = useCallback(
    async (relationshipId: string) => {
      if (!oxyServices || !activeSessionId) return false;
      setLoading(true);
      setError(null);
      try {
        await endRelationshipMutation.mutateAsync({ relationshipId });
        return true;
      } catch {
        return false;
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, endRelationshipMutation, setLoading, setError],
  );

  // Clear error
  const clearError = useCallback(() => {
    clearStoreError();
  }, [clearStoreError]);

  return {
    profiles,
    requests,
    relationships,
    isLoading: isLoading || profilesQuery.isFetching || requestsQuery.isFetching || relationshipsQuery.isFetching,
    error,
    fetchProfiles,
    fetchRequests,
    fetchRelationships,
    sendRequest,
    acceptRequest,
    declineRequest,
    endRelationship,
    clearError,
  };
};
