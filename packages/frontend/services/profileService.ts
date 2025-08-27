import { api, ApiError } from '@/utils/api';
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
  PriceUnit,
} from '@homiio/shared-types';

// Re-export the types for backward compatibility
export type {
  Profile,
  PersonalProfile,
  AgencyProfile,
  BusinessProfile,
  CooperativeProfile,
  CreateProfileData,
  UpdateProfileData,
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
  PriceUnit,
};

class ProfileService {
  private baseUrl = '/api/profiles';

  /**
   * Get or create user's primary profile
   */
  async getOrCreatePrimaryProfile(): Promise<Profile | null> {
    try {
      console.log('ProfileService: Fetching primary profile from /api/profiles/me');
      const response = await api.get(`${this.baseUrl}/me`);
      const profile = response.data.data; // Can be null if not created
      console.log(
        'ProfileService: Successfully retrieved primary profile:',
        profile ? 'Profile exists' : 'No profile',
      );
      return profile;
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 404) {
        console.log('ProfileService: 404 error, creating basic personal profile');
        // Create a basic personal profile if none exists
        const createResponse = await api.post(
          `${this.baseUrl}`,
          { isPersonalProfile: true },
        );
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
  async getUserProfiles(): Promise<Profile[]> {
    try {
      const response = await api.get(`${this.baseUrl}/me/all`);
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
  async getProfileByType(profileType: ProfileType): Promise<Profile> {
    try {
      const response = await api.get(`${this.baseUrl}/me/${profileType}`);
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
  async createProfile(profileData: CreateProfileData): Promise<Profile> {
    try {
      const response = await api.post(`${this.baseUrl}`, profileData);
      return response.data.data;
    } catch (error) {
      console.error('Error creating profile:', error);
      throw error;
    }
  }

  /**
   * Update primary profile (no profile ID needed)
   */
  async updatePrimaryProfile(updateData: UpdateProfileData): Promise<Profile> {
    try {
      console.log('ProfileService: Updating primary profile with data:', updateData);

      const response = await api.put(`${this.baseUrl}/me`, updateData);
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
  async updatePrimaryTrustScore(factor: string, value: number): Promise<Profile> {
    const response = await api.patch(`${this.baseUrl}/me/trust-score`, {
      factor,
      value,
    });

    return response.data.data;
  }

  /**
   * Recalculate primary profile trust score
   */
  async recalculatePrimaryTrustScore(): Promise<{ profile: Profile; trustScore: any }> {
    const response = await api.post(`${this.baseUrl}/me/trust-score/recalculate`);

    return response.data.data;
  }

  /**
   * Update profile
   */
  async updateProfile(profileId: string, updateData: UpdateProfileData): Promise<Profile> {
    try {
      console.log('ProfileService.updateProfile called with:', { profileId, updateData });
      console.log('Making API call to:', `${this.baseUrl}/${profileId}`);

      const response = await api.put(`${this.baseUrl}/${profileId}`, updateData);
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
  async deleteProfile(profileId: string): Promise<void> {
    try {
      await api.delete(`${this.baseUrl}/${profileId}`);
    } catch (error) {
      console.error('Error deleting profile:', error);
      throw error;
    }
  }

  /**
   * Get agency memberships for the current user
   */
  async getAgencyMemberships(): Promise<Profile[]> {
    try {
      const response = await api.get(`${this.baseUrl}/me/agency-memberships`);
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
  async addAgencyMember(profileId: string, memberOxyUserId: string, role: AgencyRole): Promise<Profile> {
    try {
      const response = await api.post(`${this.baseUrl}/${profileId}/members`, {
        memberOxyUserId,
        role,
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
  async removeAgencyMember(profileId: string, memberOxyUserId: string): Promise<Profile> {
    try {
      const response = await api.delete(`${this.baseUrl}/${profileId}/members/${memberOxyUserId}`);
      return response.data.data;
    } catch (error) {
      console.error('Error removing agency member:', error);
      throw error;
    }
  }

  /**
   * Update trust score
   */
  async updateTrustScore(profileId: string, factor: string, value: number): Promise<Profile> {
    try {
      const response = await api.patch(`${this.baseUrl}/${profileId}/trust-score`, {
        factor,
        value,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error updating trust score:', error);
      throw error;
    }
  }

  /**
   * Activate profile
   */
  async activateProfile(profileId: string): Promise<Profile> {
    try {
      console.log('ProfileService.activateProfile called with:', { profileId });
      console.log('Making API call to:', `${this.baseUrl}/${profileId}/activate`);

      const response = await api.post(`${this.baseUrl}/${profileId}/activate`);
      console.log('ProfileService.activateProfile API response:', response);

      const activatedProfile = response.data.data;
      console.log('ProfileService.activateProfile activated profile:', activatedProfile);

      return activatedProfile;
    } catch (error) {
      console.error('ProfileService.activateProfile error:', error);
      throw error;
    }
  }

  /**
   * Get profile by ID
   */
  async getProfileById(profileId: string): Promise<Profile> {
    try {
      const response = await api.get(`${this.baseUrl}/${profileId}`);
      return response.data.data;
    } catch (error) {
      console.error('Error getting profile by ID:', error);
      throw error;
    }
  }
}

export default new ProfileService();
