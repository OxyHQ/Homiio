import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/core';
import { Profile, PersonalProfile, PropertyPreferences, RoommatePreferences } from '@homiio/shared-types';

// Re-export the types for backward compatibility
export type { Profile, PersonalProfile, RoommatePreferences };

/**
 * The roommate matching preference values nested inside
 * `RoommatePreferences.preferences` (budget, lifestyle, schedule, etc.).
 */
export type RoommateMatchingPreferences = NonNullable<RoommatePreferences['preferences']>;

/**
 * A profile as returned inside roommate DTOs. Extends the base {@link Profile}
 * with the backend-hydrated Oxy `displayName` and the computed compatibility
 * `matchScore`.
 */
export interface RoommateProfile extends Profile {
  displayName?: string;
  matchScore?: number;
}

/** A serialized roommate request as returned by `GET /roommates/requests`. */
export interface RoommateRequestDTO {
  id: string;
  senderProfileId?: string;
  receiverProfileId?: string;
  sender: RoommateProfile | null;
  receiver: RoommateProfile | null;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  message?: string;
  matchScore: number;
  createdAt: string;
}

/** A serialized roommate relationship as returned by `GET /roommates/relationships`. */
export interface RoommateRelationshipDTO {
  id: string;
  oxyUser1Id?: string;
  oxyUser2Id?: string;
  profile1: RoommateProfile | null;
  profile2: RoommateProfile | null;
  status: 'active' | 'inactive' | 'ended';
  matchScore: number;
  startDate: string;
  endDate?: string;
}

export interface RoommateFilters {
  minMatchPercentage?: number;
  maxBudget?: number;
  withPets?: boolean;
  nonSmoking?: boolean;
  interests?: string[];
  ageRange?: {
    min: number;
    max: number;
  };
  gender?: 'male' | 'female' | 'any';
  location?: string;
}

/**
 * Oxy account fields the backend may attach to a profile to enrich roommate
 * results (name, bio, location). Not part of the persisted profile model, so
 * it is modelled as an optional extension of {@link Profile}.
 */
interface EnrichedProfile extends Profile {
  userData?: {
    fullName?: string;
    bio?: string;
    location?: string;
  };
}

/** Response shape for the roommate-matching toggle endpoint. */
interface ToggleMatchingResponse {
  enabled?: boolean;
  message?: string;
}

/**
 * Roommate matching API.
 *
 * Auth is resolved internally by the shared `api` client (via `oxyClient`
 * access tokens), so the optional `oxyServices` / `activeSessionId` arguments
 * accepted by the methods below are no longer forwarded to the transport.
 * They are retained on the public signatures so existing call sites that still
 * pass an Oxy session context continue to type-check during the migration.
 */
class RoommateService {
  private baseUrl = '/api/roommates';

  // Get all available roommate profiles (personal profiles with roommate enabled)
  async getRoommateProfiles(
    filters?: RoommateFilters,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<{
    profiles: RoommateProfile[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await api.get<{
      profiles?: (Profile & { matchPercentage?: number; matchScore?: number })[];
      total?: number;
      page?: number;
      totalPages?: number;
    }>(this.baseUrl, { params: filters });
    const data = response.data;
    return {
      profiles: (data.profiles ?? []).map((p) => ({
        ...p,
        matchScore: p.matchPercentage ?? p.matchScore,
      })),
      total: data.total ?? 0,
      page: data.page ?? 1,
      totalPages: data.totalPages ?? 1,
    };
  }

  // Get current user's roommate preferences (the inner matching-preferences
  // slice persisted under `roommate.preferences`).
  async getMyRoommatePreferences(
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<RoommateMatchingPreferences | null> {
    const response = await api.get<{ data?: RoommateMatchingPreferences | null }>(
      `${this.baseUrl}/preferences`,
    );
    return response.data.data ?? null;
  }

  // Get current user's roommate matching status (enabled flag)
  async getMyRoommateStatus(
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<{ hasRoommateMatching: boolean } | null> {
    try {
      const response = await api.get(`${this.baseUrl}/status`);
      return { hasRoommateMatching: Boolean(response.data.hasRoommateMatching) };
    } catch (error) {
      return null;
    }
  }

  // Update roommate preferences. The matching-preference fields are sent flat
  // (top-level) to match the backend's field whitelist; `enabled` toggles the
  // matching flag in the same call when provided. Returns the saved prefs.
  async updateRoommatePreferences(
    preferences: RoommateMatchingPreferences,
    enabled?: boolean,
  ): Promise<RoommateMatchingPreferences | null> {
    const body: Record<string, unknown> = { ...preferences };
    if (typeof enabled === 'boolean') {
      body.enabled = enabled;
    }
    const response = await api.put<{ data?: RoommateMatchingPreferences | null }>(
      `${this.baseUrl}/preferences`,
      body,
    );
    return response.data.data ?? null;
  }

  // Enable/disable roommate matching for current profile
  async toggleRoommateMatching(
    enabled: boolean,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<{ enabled: boolean; message: string }> {
    try {
      const response = await api.patch<ToggleMatchingResponse>(`${this.baseUrl}/toggle`, { enabled });
      const data = response.data;
      // Fallback if backend doesn't include enabled for some reason
      return {
        enabled: typeof data.enabled === 'boolean' ? data.enabled : enabled,
        message: data.message ?? `Roommate matching ${enabled ? 'enabled' : 'disabled'} successfully`,
      };
    } catch (error) {
      throw error;
    }
  }

  // Send roommate request
  async sendRoommateRequest(
    profileId: string,
    message?: string,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<void> {
    try {
      await api.post(`${this.baseUrl}/${profileId}/request`, { message });
    } catch (error) {
      throw error;
    }
  }

  // Get roommate requests (sent and received)
  async getRoommateRequests(
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<{
    sent: RoommateRequestDTO[];
    received: RoommateRequestDTO[];
  }> {
    const response = await api.get<{ data?: { sent?: RoommateRequestDTO[]; received?: RoommateRequestDTO[] } }>(
      `${this.baseUrl}/requests`,
    );
    const data = response.data.data;
    return {
      sent: data?.sent ?? [],
      received: data?.received ?? [],
    };
  }

  // Decline roommate request
  async declineRoommateRequest(
    requestId: string,
    responseMessage?: string,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<void> {
    try {
      await api.post(`${this.baseUrl}/requests/${requestId}/decline`, { responseMessage });
    } catch (error) {
      throw error;
    }
  }

  // Accept roommate request
  async acceptRoommateRequest(
    requestId: string,
    responseMessage?: string,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<void> {
    try {
      await api.post(`${this.baseUrl}/requests/${requestId}/accept`, { responseMessage });
    } catch (error) {
      throw error;
    }
  }

  // Get roommate relationships for the current profile
  async getRoommateRelationships(
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<{ data: RoommateRelationshipDTO[] }> {
    const response = await api.get<{ data?: RoommateRelationshipDTO[] }>(
      `${this.baseUrl}/relationships`,
    );
    return { data: response.data.data ?? [] };
  }

  // End roommate relationship
  async endRoommateRelationship(
    relationshipId: string,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<void> {
    try {
      await api.delete(`${this.baseUrl}/relationships/${relationshipId}`);
    } catch (error) {
      throw error;
    }
  }

  // Check if a profile has roommate matching enabled
  hasRoommateMatchingEnabled(profile: Profile): boolean {
    return profile.personalProfile?.settings?.roommate?.enabled || false;
  }

  // Get the roommate matching preferences (budget, lifestyle, schedule, ...)
  // nested inside a profile's roommate settings.
  getRoommatePreferencesFromProfile(profile: Profile): RoommateMatchingPreferences | null {
    return profile.personalProfile?.settings?.roommate?.preferences ?? null;
  }

  // Calculate match percentage between two profiles
  calculateMatchPercentage(profile1: Profile, profile2: Profile): number {
    if (!profile1.personalProfile || !profile2.personalProfile) return 0;

    const prefs1 = profile1.personalProfile.settings?.roommate?.preferences;
    const prefs2 = profile2.personalProfile.settings?.roommate?.preferences;

    if (!prefs1 || !prefs2) return 0;

    let matchScore = 0;
    let totalFactors = 0;

    // Budget compatibility
    if (prefs1.budget && prefs2.budget) {
      const overlap =
        Math.min(prefs1.budget.max, prefs2.budget.max) -
        Math.max(prefs1.budget.min, prefs2.budget.min);
      if (overlap > 0) {
        matchScore += 20;
      }
      totalFactors += 20;
    }

    // Lifestyle compatibility
    if (prefs1.lifestyle && prefs2.lifestyle) {
      if (prefs1.lifestyle.smoking === prefs2.lifestyle.smoking) matchScore += 15;
      if (prefs1.lifestyle.pets === prefs2.lifestyle.pets) matchScore += 15;
      if (prefs1.lifestyle.cleanliness === prefs2.lifestyle.cleanliness) matchScore += 15;
      if (prefs1.lifestyle.schedule === prefs2.lifestyle.schedule) matchScore += 15;
      totalFactors += 60;
    }

    // Move-in date compatibility
    if (prefs1.moveInDate && prefs2.moveInDate) {
      const date1 = new Date(prefs1.moveInDate);
      const date2 = new Date(prefs2.moveInDate);
      const diffDays = Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays <= 30) {
        matchScore += 20;
      }
      totalFactors += 20;
    }

    return totalFactors > 0 ? Math.round((matchScore / totalFactors) * 100) : 0;
  }

  // Extract display information from a profile for roommate matching.
  // Trust/verification fields are derived from the profile's real data;
  // when the data is absent they fall back to undefined/false rather than
  // optimistic fake values.
  getProfileDisplayInfo(profile: Profile): {
    name: string;
    age?: number;
    occupation: string;
    bio: string;
    location: string;
    budget: { min: number; max: number; currency: string };
    moveInDate: string;
    duration: string;
    trustScore?: number;
    isVerified: boolean;
    hasReferences: boolean;
    rentalHistory: boolean;
  } {
    const personal = profile.personalProfile;
    const roommatePrefs = personal?.settings?.roommate?.preferences;

    // Use enriched Oxy user data if available
    const userData = (profile as EnrichedProfile).userData;

    // Try to extract name from various possible sources
    let name = 'User';
    if (userData?.fullName) {
      name = userData.fullName;
    } else if (personal?.personalInfo?.bio) {
      // Try to extract name from bio (first few words)
      const bioWords = personal.personalInfo.bio.split(' ');
      if (bioWords.length > 0 && bioWords[0].length > 2) {
        name = bioWords[0];
      }
    }

    const verification = personal?.verification;

    return {
      name,
      age: undefined,
      occupation: personal?.personalInfo?.occupation || 'Not specified',
      bio: userData?.bio || personal?.personalInfo?.bio || 'No bio available',
      location:
        userData?.location || this.extractLocation(personal?.preferences),
      budget: {
        min: roommatePrefs?.budget?.min || 0,
        max: roommatePrefs?.budget?.max || 0,
        currency: 'USD',
      },
      moveInDate: roommatePrefs?.moveInDate || 'Flexible',
      duration: roommatePrefs?.leaseDuration || 'Flexible',
      trustScore: typeof personal?.trustScore?.score === 'number'
        ? personal.trustScore.score
        : undefined,
      isVerified: Boolean(verification?.identity),
      hasReferences:
        (personal?.references?.length ?? 0) > 0 || Boolean(verification?.references),
      rentalHistory:
        (personal?.rentalHistory?.length ?? 0) > 0 || Boolean(verification?.rentalHistory),
    };
  }

  private extractLocation(preferences?: PropertyPreferences): string {
    const location = preferences?.preferredLocations?.[0];
    if (location?.city && location?.state) {
      return `${location.city}, ${location.state}`;
    }
    return 'Location not specified';
  }
}

export const roommateService = new RoommateService();
