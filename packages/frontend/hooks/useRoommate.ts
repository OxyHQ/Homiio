import { useCallback } from 'react';
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
  const {
    roommates: profiles,
    requests,
    relationships,
    isLoading,
    error,
  } = useRoommateSelectors();
  const {
    setRoommates,
    setRequests,
    setRelationships,
    setLoading,
    setError,
    clearError: clearStoreError,
  } = useRoommateStore();
  const { oxyServices, activeSessionId } = useOxy();

  // Fetch roommate profiles
  const fetchProfiles = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await roommateService.getRoommateProfiles(undefined, oxyServices, activeSessionId);
      setRoommates(response.profiles || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch profiles');
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, setLoading, setError, setRoommates]);

  // Fetch roommate requests
  const fetchRequests = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await roommateService.getRoommateRequests(oxyServices, activeSessionId);
      setRequests(response || { sent: [], received: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch requests');
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, setLoading, setError, setRequests]);

  // Fetch roommate relationships
  const fetchRelationships = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await roommateService.getRoommateRelationships(oxyServices, activeSessionId);
      setRelationships(response.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch relationships');
    } finally {
      setLoading(false);
    }
  }, [oxyServices, activeSessionId, setLoading, setError, setRelationships]);

  // Send roommate request
  const sendRequest = useCallback(async (profileId: string, message?: string) => {
    if (!oxyServices || !activeSessionId) return false;

    try {
      setLoading(true);
      setError(null);
      await roommateService.sendRoommateRequest(profileId, message, oxyServices, activeSessionId);
      await fetchRequests();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send request');
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchRequests, oxyServices, activeSessionId, setLoading, setError]);

  // Accept roommate request
  const acceptRequest = useCallback(async (requestId: string, responseMessage?: string) => {
    if (!oxyServices || !activeSessionId) return false;

    try {
      setLoading(true);
      setError(null);
      await roommateService.acceptRoommateRequest(requestId, responseMessage, oxyServices, activeSessionId);
      await Promise.all([fetchRequests(), fetchRelationships()]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept request');
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchRequests, fetchRelationships, oxyServices, activeSessionId, setLoading, setError]);

  // Decline roommate request
  const declineRequest = useCallback(async (requestId: string, responseMessage?: string) => {
    if (!oxyServices || !activeSessionId) return false;

    try {
      setLoading(true);
      setError(null);
      await roommateService.declineRoommateRequest(requestId, responseMessage, oxyServices, activeSessionId);
      await fetchRequests();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline request');
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchRequests, oxyServices, activeSessionId, setLoading, setError]);

  // End roommate relationship
  const endRelationship = useCallback(async (relationshipId: string) => {
    if (!oxyServices || !activeSessionId) return false;

    try {
      setLoading(true);
      setError(null);
      await roommateService.endRoommateRelationship(relationshipId, oxyServices, activeSessionId);
      await fetchRelationships();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end relationship');
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchRelationships, oxyServices, activeSessionId, setLoading, setError]);

  // Clear error
  const clearError = useCallback(() => {
    clearStoreError();
  }, [clearStoreError]);

  return {
    profiles,
    requests,
    relationships,
    isLoading,
    error,
    fetchProfiles,
    fetchRequests,
    fetchRelationships,
    sendRequest,
    acceptRequest,
    declineRequest,
    endRelationship,
    clearError
  };
}; 