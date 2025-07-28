import { api, ApiError } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';
import { 
  Profile, 
  PersonalProfile, 
  AgencyProfile, 
  BusinessProfile, 
  CooperativeProfile,
  CreateProfileData,
  UpdateProfileData,
  ProfileType,
  EmploymentStatus,
  LeaseDuration,
  BusinessType,
  ReferenceRelationship,
  ReasonForLeaving,
  ProfileVisibility,
  AgencyRole,
  CooperativeRole,
  PriceUnit
} from '@homiio/shared-types';

// Re-export the types for backward compatibility
export type { 
  Profile, 
  PersonalProfile, 
  AgencyProfile, 
  BusinessProfile, 
  CooperativeProfile,
  CreateProfileData,
  UpdateProfileData
};

// Re-export enums for backward compatibility
export { 
  ProfileType,
  EmploymentStatus,
  LeaseDuration,
  BusinessType,
  ReferenceRelationship,
  ReasonForLeaving,
  ProfileVisibility,
  AgencyRole,
  CooperativeRole,
  PriceUnit
};





class ProfileService {
  private baseUrl = '/api/profiles';

  /**
   * Get or create user's primary profile
   */
  async getOrCreatePrimaryProfile(oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile | null> {
    try {
      console.log('ProfileService: Fetching primary profile from /api/profiles/me');
      const response = await api.get(`${this.baseUrl}/me`, {
        oxyServices,
        activeSessionId,
      });
      const profile = response.data.data; // Can be null if not created
      console.log('ProfileService: Successfully retrieved primary profile:', profile ? 'Profile exists' : 'No profile');
      return profile;
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 404) {
        console.log('ProfileService: 404 error, creating basic personal profile');
        // Create a basic personal profile if none exists
        const createResponse = await api.post(`${this.baseUrl}`, { isPersonalProfile: true }, {
          oxyServices,
          activeSessionId,
        });
        console.log('ProfileService: Successfully created personal profile');
        return createResponse.data.data;
      }
      console.error('Error fetching primary profile:', error);
      throw error;
    }
  }

  /**
   * Get all profiles for the current user
   */
  async getUserProfiles(oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile[]> {
    try {
      const response = await api.get(`${this.baseUrl}/me/all`, {
        oxyServices,
        activeSessionId,
      });
      const profiles = response.data.data;
      return profiles;
    } catch (error) {
      console.error('Error getting user profiles:', error);
      throw error;
    }
  }

  /**
   * Get profile by type
   */
  async getProfileByType(profileType: ProfileType, oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
    try {
      const response = await api.get(`${this.baseUrl}/me/${profileType}`, {
        oxyServices,
        activeSessionId,
      });
      const profile = response.data.data;
      return profile;
    } catch (error) {
      console.error('Error getting profile by type:', error);
      throw error;
    }
  }

  /**
   * Create a new profile
   */
  async createProfile(profileData: CreateProfileData, oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
    try {
      const response = await api.post(`${this.baseUrl}`, profileData, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error creating profile:', error);
      throw error;
    }
  }

  /**
   * Update primary profile (no profile ID needed)
   */
  async updatePrimaryProfile(updateData: UpdateProfileData, oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
    try {
      console.log('ProfileService: Updating primary profile with data:', updateData);
      
      const response = await api.put(`${this.baseUrl}/me`, updateData, {
        oxyServices,
        activeSessionId,
      });
      const updatedProfile = response.data.data;

      console.log('ProfileService: Received updated profile from server:', updatedProfile);

      return updatedProfile;
    } catch (error) {
      console.error('Error updating primary profile:', error);
      throw error;
    }
  }

  /**
   * Update primary profile trust score
   */
  async updatePrimaryTrustScore(factor: string, value: number, oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
    const response = await api.patch(`${this.baseUrl}/me/trust-score`, {
      factor,
      value
    }, {
      oxyServices,
      activeSessionId,
    });
    
    return response.data.data;
  }

  /**
   * Recalculate primary profile trust score
   */
  async recalculatePrimaryTrustScore(oxyServices?: OxyServices, activeSessionId?: string): Promise<{ profile: Profile; trustScore: any }> {
    const response = await api.post(`${this.baseUrl}/me/trust-score/recalculate`, undefined, {
      oxyServices,
      activeSessionId,
    });
    
    return response.data.data;
  }

  /**
   * Update profile
   */
  async updateProfile(profileId: string, updateData: UpdateProfileData, oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
    try {
      console.log('ProfileService.updateProfile called with:', { profileId, updateData });
      console.log('Making API call to:', `${this.baseUrl}/${profileId}`);
      
      const response = await api.put(`${this.baseUrl}/${profileId}`, updateData, {
        oxyServices,
        activeSessionId,
      });
      console.log('ProfileService.updateProfile API response:', response);
      
      const updatedProfile = response.data.data;
      console.log('ProfileService.updateProfile updated profile:', updatedProfile);

      return updatedProfile;
    } catch (error) {
      console.error('ProfileService.updateProfile error:', error);
      throw error;
    }
  }

  /**
   * Delete profile
   */
  async deleteProfile(profileId: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<void> {
    try {
      await api.delete(`${this.baseUrl}/${profileId}`, {
        oxyServices,
        activeSessionId,
      });
    } catch (error) {
      console.error('Error deleting profile:', error);
      throw error;
    }
  }

  /**
   * Get agency memberships for the current user
   */
  async getAgencyMemberships(oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile[]> {
    try {
      const response = await api.get(`${this.baseUrl}/me/agency-memberships`, {
        oxyServices,
        activeSessionId,
      });
      const memberships = response.data.data;
      return memberships;
    } catch (error) {
      console.error('Error getting agency memberships:', error);
      throw error;
    }
  }

  /**
   * Add member to agency profile
   */
  async addAgencyMember(profileId: string, memberOxyUserId: string, role: AgencyRole, oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
    try {
      const response = await api.post(`${this.baseUrl}/${profileId}/members`, {
        memberOxyUserId,
        role,
      }, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error adding agency member:', error);
      throw error;
    }
  }

  /**
   * Remove member from agency profile
   */
  async removeAgencyMember(profileId: string, memberOxyUserId: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
    try {
      const response = await api.delete(`${this.baseUrl}/${profileId}/members/${memberOxyUserId}`, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error removing agency member:', error);
      throw error;
    }
  }

  /**
   * Update trust score
   */
  async updateTrustScore(profileId: string, factor: string, value: number, oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
    try {
      const response = await api.patch(`${this.baseUrl}/${profileId}/trust-score`, {
        factor,
        value,
      }, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error updating trust score:', error);
      throw error;
    }
  }

  /**
   * Get profile by ID
   */
  async getProfileById(profileId: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
    try {
      const response = await api.get(`${this.baseUrl}/${profileId}`, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error getting profile by ID:', error);
      throw error;
    }
  }
}

export default new ProfileService(); 