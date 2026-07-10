import { api } from '@/utils/api';
import type {
  Profile,
  UpdateProfileData,
  PersonalProfile,
  AgencyProfile,
  BusinessProfile,
  CooperativeProfile,
} from '@homiio/shared-types';

export type {
  Profile,
  UpdateProfileData,
  PersonalProfile,
  AgencyProfile,
  BusinessProfile,
  CooperativeProfile,
};

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
} from '@homiio/shared-types';

class ProfileService {
  private baseUrl = '/api/profiles';

  async getOrCreateProfile(): Promise<Profile> {
    const response = await api.get(`${this.baseUrl}/me`);
    return response.data.data;
  }

  /** @deprecated Use getOrCreateProfile */
  async getOrCreatePrimaryProfile(): Promise<Profile> {
    return this.getOrCreateProfile();
  }

  /** @deprecated One sidecar per account */
  async getUserProfiles(): Promise<Profile[]> {
    const profile = await this.getOrCreateProfile();
    return [profile];
  }

  async updateProfile(profileId: string, updateData: UpdateProfileData): Promise<Profile> {
    const response = await api.put(`${this.baseUrl}/${profileId}`, updateData);
    return response.data.data;
  }

  async getProfileById(profileId: string): Promise<Profile> {
    const response = await api.get(`${this.baseUrl}/${profileId}`);
    return response.data.data;
  }

  async getPublicProfileById(profileId: string): Promise<Profile> {
    const response = await api.get(`/api/public/profiles/${profileId}`, {
      requireAuth: false,
    });
    return response.data.data;
  }
}

export default new ProfileService();
