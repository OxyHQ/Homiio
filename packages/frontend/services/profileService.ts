import { api, ApiError } from '@/utils/api';
import {
  Profile,
  PersonalProfile,
  UpdateProfileData,
  EmploymentStatus,
  LeaseDuration,
  ReferenceRelationship,
  ReasonForLeaving,
  ProfileVisibility,
  PriceUnit,
} from '@homiio/shared-types';

export type { Profile, PersonalProfile, UpdateProfileData };

export {
  EmploymentStatus,
  LeaseDuration,
  ReferenceRelationship,
  ReasonForLeaving,
  ProfileVisibility,
  PriceUnit,
};

class ProfileService {
  private baseUrl = '/api/profiles';

  async getOrCreateProfile(): Promise<Profile | null> {
    const response = await api.get(`${this.baseUrl}/me`);
    return response.data.data;
  }

  async updateMyProfile(updateData: UpdateProfileData): Promise<Profile> {
    const response = await api.put(`${this.baseUrl}/me`, updateData);
    return response.data.data;
  }

  async getProfileByOxyUserId(oxyUserId: string): Promise<Profile> {
    const response = await api.get(`${this.baseUrl}/oxy/${encodeURIComponent(oxyUserId)}`);
    return response.data.data;
  }

  async getPublicProfileByOxyUserId(oxyUserId: string): Promise<Profile> {
    const response = await api.get(
      `/api/public/profiles/oxy/${encodeURIComponent(oxyUserId)}`,
      { requireAuth: false },
    );
    return response.data.data;
  }
}

export default new ProfileService();
