import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';

export interface PersonalProfile {
  personalInfo?: {
    bio?: string;
    occupation?: string;
    employer?: string;
    annualIncome?: number;
    employmentStatus?: 'employed' | 'self_employed' | 'student' | 'retired' | 'unemployed' | 'other';
    moveInDate?: string;
    leaseDuration?: 'monthly' | '3_months' | '6_months' | 'yearly' | 'flexible';
  };
  preferences: {
    propertyTypes?: string[];
    maxRent?: number;
    priceUnit?: 'day' | 'night' | 'week' | 'month' | 'year';
    minBedrooms?: number;
    minBathrooms?: number;
    preferredAmenities?: string[];
    preferredLocations?: Array<{
      city: string;
      state: string;
      radius: number;
    }>;
    petFriendly?: boolean;
    smokingAllowed?: boolean;
    furnished?: boolean;
    parkingRequired?: boolean;
    accessibility?: boolean;
  };
  references?: Array<{
    name: string;
    relationship: 'landlord' | 'employer' | 'personal' | 'other';
    phone?: string;
    email?: string;
    verified?: boolean;
  }>;
  rentalHistory?: Array<{
    address: string;
    startDate: string;
    endDate?: string;
    monthlyRent?: number;
    reasonForLeaving?: 'lease_ended' | 'bought_home' | 'job_relocation' | 'family_reasons' | 'upgrade' | 'other';
    landlordContact?: {
      name?: string;
      phone?: string;
      email?: string;
    };
    verified?: boolean;
  }>;
  verification: {
    identity: boolean;
    income: boolean;
    background: boolean;
    rentalHistory: boolean;
    references?: boolean;
  };
  trustScore: {
    score: number;
    factors: Array<{
      type: string;
      value: number;
      updatedAt: string;
    }>;
  };
  settings: {
    notifications: {
      email: boolean;
      push: boolean;
      sms: boolean;
      propertyAlerts?: boolean;
      viewingReminders?: boolean;
      leaseUpdates?: boolean;
    };
    privacy: {
      profileVisibility: 'public' | 'private' | 'contacts_only';
      showContactInfo: boolean;
      showIncome: boolean;
      showRentalHistory?: boolean;
      showReferences?: boolean;
    };
    roommate?: {
      enabled: boolean;
      preferences?: {
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
      };
      history?: Array<{
        startDate: string;
        endDate?: string;
        location: string;
        roommateCount?: number;
        reason?: string;
      }>;
    };
    language: string;
    timezone: string;
    currency?: string;
  };
}

export interface AgencyProfile {
  businessType: 'real_estate_agency' | 'property_management' | 'brokerage' | 'developer' | 'other';
  legalCompanyName?: string;
  description?: string;
  businessDetails: {
    licenseNumber?: string;
    taxId?: string;
    yearEstablished?: number;
    employeeCount?: '1-10' | '11-50' | '51-200' | '200+';
    specialties?: string[];
    serviceAreas?: Array<{
      city: string;
      state: string;
      radius: number;
    }>;
  };
  verification: {
    businessLicense: boolean;
    insurance: boolean;
    bonding: boolean;
    backgroundCheck: boolean;
  };
  ratings: {
    average: number;
    count: number;
  };
  members: Array<{
    oxyUserId: string;
    role: 'owner' | 'admin' | 'agent' | 'viewer';
    addedAt: string;
    addedBy?: string;
  }>;
}

export interface BusinessProfile {
  businessType: 'small_business' | 'startup' | 'freelancer' | 'consultant' | 'other';
  legalCompanyName?: string;
  description?: string;
  businessDetails: {
    licenseNumber?: string;
    taxId?: string;
    yearEstablished?: number;
    employeeCount?: '1-5' | '6-10' | '11-25' | '26+';
    industry?: string;
    specialties?: string[];
    serviceAreas?: Array<{
      city: string;
      state: string;
      radius: number;
    }>;
  };
  verification: {
    businessLicense: boolean;
    insurance: boolean;
    backgroundCheck: boolean;
  };
  ratings: {
    average: number;
    count: number;
  };
}

export interface CooperativeProfile {
  legalName: string;
  description?: string;
  members: Array<{
    oxyUserId: string;
    role: 'owner' | 'admin' | 'member';
    addedAt: string;
  }>;
}

export interface Profile {
  id: string;
  _id?: string;
  oxyUserId: string;
  profileType: 'personal' | 'agency' | 'business' | 'cooperative';
  isPrimary: boolean;
  isActive: boolean;
  personalProfile?: PersonalProfile;
  agencyProfile?: AgencyProfile;
  businessProfile?: BusinessProfile;
  cooperativeProfile?: CooperativeProfile;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileData {
  profileType: 'personal' | 'agency' | 'business' | 'cooperative';
  data: {
    preferences?: PersonalProfile['preferences'];
    verification?: PersonalProfile['verification'];
    settings?: PersonalProfile['settings'];
    businessType?: AgencyProfile['businessType'] | BusinessProfile['businessType'];
    description?: string;
    businessDetails?: AgencyProfile['businessDetails'] | BusinessProfile['businessDetails'];
    legalCompanyName?: string;
    legalName?: string;
  };
}

export interface UpdateProfileData {
  personalProfile?: Partial<PersonalProfile>;
  agencyProfile?: Partial<AgencyProfile>;
  businessProfile?: Partial<BusinessProfile>;
  isPrimary?: boolean;
  isActive?: boolean;
}

class ProfileService {
  private baseUrl = '/api/profiles';

  /**
   * Get or create user's primary profile
   */
  async getOrCreatePrimaryProfile(oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile | null> {
    const response = await api.get(`${this.baseUrl}/me`, {
      oxyServices,
      activeSessionId,
    });
    const profile = response.data.data; // This can now be null
    
    return profile;
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
  async getProfileByType(profileType: 'personal' | 'agency' | 'business', oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
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
  async addAgencyMember(profileId: string, memberOxyUserId: string, role: 'owner' | 'admin' | 'agent' | 'viewer', oxyServices?: OxyServices, activeSessionId?: string): Promise<Profile> {
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