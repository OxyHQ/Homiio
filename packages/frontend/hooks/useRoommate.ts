import { useState, useEffect, useCallback } from 'react';
import { roommateService } from '@/services/roommateService';
import type { Profile } from '@/services/profileService';

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
  const [profiles, setProfiles] = useState<RoommateProfile[]>([]);
  const [requests, setRequests] = useState<{
    sent: RoommateRequest[];
    received: RoommateRequest[];
  }>({ sent: [], received: [] });
  const [relationships, setRelationships] = useState<RoommateRelationship[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch roommate profiles
  const fetchProfiles = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await roommateService.getRoommateProfiles();
      setProfiles(response.profiles || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch profiles');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch roommate requests
  const fetchRequests = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await roommateService.getRoommateRequests();
      setRequests(response || { sent: [], received: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch requests');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch roommate relationships
  const fetchRelationships = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await roommateService.getRoommateRelationships();
      setRelationships(response.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch relationships');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Send roommate request
  const sendRequest = useCallback(async (profileId: string, message?: string) => {
    try {
      setIsLoading(true);
      setError(null);
      await roommateService.sendRoommateRequest(profileId, message);
      // Refresh requests after sending
      await fetchRequests();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send request');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchRequests]);

  // Accept roommate request
  const acceptRequest = useCallback(async (requestId: string, responseMessage?: string) => {
    try {
      setIsLoading(true);
      setError(null);
      await roommateService.acceptRoommateRequest(requestId, responseMessage);
      // Refresh requests and relationships after accepting
      await Promise.all([fetchRequests(), fetchRelationships()]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept request');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchRequests, fetchRelationships]);

  // Decline roommate request
  const declineRequest = useCallback(async (requestId: string, responseMessage?: string) => {
    try {
      setIsLoading(true);
      setError(null);
      await roommateService.declineRoommateRequest(requestId, responseMessage);
      // Refresh requests after declining
      await fetchRequests();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline request');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchRequests]);

  // End roommate relationship
  const endRelationship = useCallback(async (relationshipId: string) => {
    try {
      setIsLoading(true);
      setError(null);
      await roommateService.endRoommateRelationship(relationshipId);
      // Refresh relationships after ending
      await fetchRelationships();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end relationship');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchRelationships]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

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