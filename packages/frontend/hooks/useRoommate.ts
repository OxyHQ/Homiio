import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { roommateService } from '@/services/roommateService';
import type { Profile } from '@/services/profileService';
import { useRoommateStore, useRoommateSelectors } from '@/store/roommateStore';
import { useOxy } from '@oxyhq/services';

export interface RoommateProfile extends Profile {
  matchScore?: number;
  /** Oxy account display name, hydrated by the backend serializer. */
  displayName?: string;
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
  oxyUser1Id: string;
  oxyUser2Id: string;
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

  // Queries (disabled by default; refetch on demand based on tab).
  // Store synchronization happens in the `fetch*` helpers below, using the
  // `refetch()` result, since TanStack Query v5 removed the per-query
  // `onSuccess` / `onError` callbacks.
  const profilesQuery = useQuery({
    queryKey: ['roommates', 'profiles'],
    queryFn: async () => {
      const response = await roommateService.getRoommateProfiles();
      return response.profiles || [];
    },
    enabled: false,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  const requestsQuery = useQuery({
    queryKey: ['roommates', 'requests'],
    queryFn: async () => {
      const response = await roommateService.getRoommateRequests();
      return response || { sent: [], received: [] };
    },
    enabled: false,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  const relationshipsQuery = useQuery({
    queryKey: ['roommates', 'relationships'],
    queryFn: async () => {
      const response = await roommateService.getRoommateRelationships();
      return response.data || [];
    },
    enabled: false,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  // Adapter functions to trigger refetch when requested by tabs/UI
  const fetchProfiles = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await profilesQuery.refetch();
      if (result.error) {
        setError(result.error.message || 'Failed to fetch profiles');
        return;
      }
      // Copy the array so the store never shares a reference with the query cache.
      setRoommates(Array.isArray(result.data) ? [...result.data] : []);
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, profilesQuery, setLoading, setError, setRoommates]);

  // Fetch roommate requests
  const fetchRequests = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await requestsQuery.refetch();
      if (result.error) {
        setError(result.error.message || 'Failed to fetch requests');
        return;
      }
      const data = result.data ?? { sent: [], received: [] };
      setRequests({ sent: [...(data.sent ?? [])], received: [...(data.received ?? [])] });
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, requestsQuery, setLoading, setError, setRequests]);

  // Fetch roommate relationships
  const fetchRelationships = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await relationshipsQuery.refetch();
      if (result.error) {
        setError(result.error.message || 'Failed to fetch relationships');
        return;
      }
      setRelationships(Array.isArray(result.data) ? [...result.data] : []);
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, relationshipsQuery, setLoading, setError, setRelationships]);

  // Mutations
  const sendRequestMutation = useMutation({
    mutationKey: ['roommates', 'sendRequest'],
    mutationFn: async (vars: { profileId: string; message?: string }) => {
      await roommateService.sendRoommateRequest(vars.profileId, vars.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roommates', 'requests'] });
      await fetchRequests();
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
      await roommateService.acceptRoommateRequest(vars.requestId, vars.responseMessage);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['roommates', 'requests'] }),
        queryClient.invalidateQueries({ queryKey: ['roommates', 'relationships'] }),
      ]);
      await Promise.all([fetchRequests(), fetchRelationships()]);
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
      await roommateService.declineRoommateRequest(vars.requestId, vars.responseMessage);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roommates', 'requests'] });
      await fetchRequests();
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
      await roommateService.endRoommateRelationship(vars.relationshipId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roommates', 'relationships'] });
      await fetchRelationships();
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
