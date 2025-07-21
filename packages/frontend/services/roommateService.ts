import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';
import type { Profile, PersonalProfile } from './profileService';

export interface RoommatePreferences {
  ageRange?: {
    min: number;
    max: number;
  };
  gender?: 'male' | 'female' | 'any';
  lifestyle?: {
    smoking: 'yes' | 'no' | 'prefer_not';
    pets: 'yes' | 'no' | 'prefer_not';
    partying: 'yes' | 'no' | 'prefer_not';
    cleanliness: 'very_clean' | 'clean' | 'average' | 'relaxed';
    schedule: 'early_bird' | 'night_owl' | 'flexible';
  };
  budget?: {
    min: number;
    max: number;
  };
  moveInDate?: string;
  leaseDuration?: 'monthly' | '3_months' | '6_months' | 'yearly' | 'flexible';
  interests?: string[];
  location?: string;
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

class RoommateService {
  private baseUrl = '/api/roommates';

  // Get all available roommate profiles (personal profiles with roommate enabled)
  async getRoommateProfiles(filters?: RoommateFilters, oxyServices?: OxyServices, activeSessionId?: string): Promise<{
    profiles: Profile[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(this.baseUrl, { 
        params: filters,
        oxyServices,
        activeSessionId,
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching roommate profiles:', error);
      return { profiles: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get current user's roommate preferences
  async getMyRoommatePreferences(oxyServices?: OxyServices, activeSessionId?: string): Promise<RoommatePreferences | null> {
    try {
      const response = await api.get(`${this.baseUrl}/preferences`, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching roommate preferences:', error);
      return null;
    }
  }

  // Update roommate preferences
  async updateRoommatePreferences(preferences: RoommatePreferences, oxyServices?: OxyServices, activeSessionId?: string): Promise<RoommatePreferences> {
    try {
      const response = await api.put(`${this.baseUrl}/preferences`, preferences, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error updating roommate preferences:', error);
      throw error;
    }
  }

  // Enable/disable roommate matching for current profile
  async toggleRoommateMatching(enabled: boolean, oxyServices?: OxyServices, activeSessionId?: string): Promise<void> {
    try {
      await api.patch(`${this.baseUrl}/toggle`, { enabled }, {
        oxyServices,
        activeSessionId,
      });
    } catch (error) {
      console.error('Error toggling roommate matching:', error);
      throw error;
    }
  }

  // Send roommate request
  async sendRoommateRequest(profileId: string, message?: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<void> {
    try {
      await api.post(`${this.baseUrl}/${profileId}/request`, { message }, {
        oxyServices,
        activeSessionId,
      });
    } catch (error) {
      console.error('Error sending roommate request:', error);
      throw error;
    }
  }

  // Get roommate requests (sent and received)
  async getRoommateRequests(oxyServices?: OxyServices, activeSessionId?: string): Promise<{
    sent: any[];
    received: any[];
  }> {
    try {
      const response = await api.get(`${this.baseUrl}/requests`, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching roommate requests:', error);
      return { sent: [], received: [] };
    }
  }



  // Decline roommate request
  async declineRoommateRequest(requestId: string, responseMessage?: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<void> {
    try {
      await api.post(`${this.baseUrl}/requests/${requestId}/decline`, { responseMessage }, {
        oxyServices,
        activeSessionId,
      });
    } catch (error) {
      console.error('Error declining roommate request:', error);
      throw error;
    }
  }

  // Accept roommate request
  async acceptRoommateRequest(requestId: string, responseMessage?: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<void> {
    try {
      await api.post(`${this.baseUrl}/requests/${requestId}/accept`, { responseMessage }, {
        oxyServices,
        activeSessionId,
      });
    } catch (error) {
      console.error('Error accepting roommate request:', error);
      throw error;
    }
  }

  // Get roommate relationships
  async getRoommateRelationships(oxyServices?: OxyServices, activeSessionId?: string): Promise<{
    data: any[];
  }> {
    try {
      const response = await api.get(`${this.baseUrl}/relationships`, {
        oxyServices,
        activeSessionId,
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching roommate relationships:', error);
      return { data: [] };
    }
  }

  // End roommate relationship
  async endRoommateRelationship(relationshipId: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<void> {
    try {
      await api.delete(`${this.baseUrl}/relationships/${relationshipId}`, {
        oxyServices,
        activeSessionId,
      });
    } catch (error) {
      console.error('Error ending roommate relationship:', error);
      throw error;
    }
  }

  // Check if a profile has roommate matching enabled
  hasRoommateMatchingEnabled(profile: Profile): boolean {
    return profile.personalProfile?.settings?.roommate?.enabled || false;
  }

  // Get roommate preferences from a profile
  getRoommatePreferencesFromProfile(profile: Profile): RoommatePreferences | null {
    return profile.personalProfile?.settings?.roommate?.preferences || null;
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
      const overlap = Math.min(prefs1.budget.max, prefs2.budget.max) - Math.max(prefs1.budget.min, prefs2.budget.min);
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

  // Extract display information from a profile for roommate matching
  getProfileDisplayInfo(profile: Profile): {
    name: string;
    age: number;
    occupation: string;
    bio: string;
    location: string;
    budget: { min: number; max: number; currency: string };
    moveInDate: string;
    duration: string;
    trustScore: number;
    isVerified: boolean;
    hasReferences: boolean;
    rentalHistory: boolean;
  } {
    const personal = profile.personalProfile;
    const roommatePrefs = personal?.settings?.roommate?.preferences;

    // Use enriched Oxy user data if available
    const userData = (profile as any).userData;
    
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

    return {
      name,
      age: this.calculateAge(personal?.personalInfo?.bio || ''),
      occupation: personal?.personalInfo?.occupation || 'Not specified',
      bio: userData?.bio || personal?.personalInfo?.bio || 'No bio available',
      location: userData?.location || this.extractLocation(roommatePrefs) || 'Location not specified',
      budget: {
        min: roommatePrefs?.budget?.min || 0,
        max: roommatePrefs?.budget?.max || 0,
        currency: 'USD'
      },
      moveInDate: roommatePrefs?.moveInDate || 'Flexible',
      duration: roommatePrefs?.leaseDuration || 'Flexible',
      trustScore: 85, // Placeholder - would come from trust system
      isVerified: true, // Placeholder - would come from verification system
      hasReferences: true, // Placeholder - would come from reference system
      rentalHistory: true, // Placeholder - would come from rental history system
    };
  }

  private calculateAge(bio: string): number {
    // This would need to be calculated from actual birth date
    // For now, return a default age
    return 25;
  }

  private extractLocation(preferences?: any): string {
    if (preferences?.preferredLocations && preferences.preferredLocations.length > 0) {
      const location = preferences.preferredLocations[0];
      return `${location.city}, ${location.state}`;
    }
    return 'Location not specified';
  }
}

export const roommateService = new RoommateService(); 