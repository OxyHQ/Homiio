import api, { getCacheKey, setCacheEntry, getCacheEntry, clearCache } from '@/utils/api';

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
    language: string;
    timezone: string;
    currency?: string;
  };
}

export interface RoommateProfile {
  roommatePreferences: {
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
  roommateHistory: Array<{
    startDate: string;
    endDate: string;
    location: string;
    roommateCount: number;
    reason: string;
  }>;
  references: Array<{
    name: string;
    relationship: string;
    phone: string;
    email: string;
    verified: boolean;
  }>;
}

export interface AgencyProfile {
  businessType: 'real_estate_agency' | 'property_management' | 'brokerage' | 'developer' | 'other';
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

export interface Profile {
  id: string;
  _id?: string;
  oxyUserId: string;
  profileType: 'personal' | 'roommate' | 'agency';
  isPrimary: boolean;
  isActive: boolean;
  personalProfile?: PersonalProfile;
  roommateProfile?: RoommateProfile;
  agencyProfile?: AgencyProfile;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileData {
  profileType: 'personal' | 'roommate' | 'agency';
  data: {
    preferences?: PersonalProfile['preferences'];
    verification?: PersonalProfile['verification'];
    settings?: PersonalProfile['settings'];
    roommatePreferences?: RoommateProfile['roommatePreferences'];
    roommateHistory?: RoommateProfile['roommateHistory'];
    references?: RoommateProfile['references'];
    businessType?: AgencyProfile['businessType'];
    description?: string;
    businessDetails?: AgencyProfile['businessDetails'];
  };
}

export interface UpdateProfileData {
  personalProfile?: Partial<PersonalProfile>;
  roommateProfile?: Partial<RoommateProfile>;
  agencyProfile?: Partial<AgencyProfile>;
  isPrimary?: boolean;
  isActive?: boolean;
}

class ProfileService {
  private baseUrl = '/api/profiles';

  /**
   * Get or create user's primary profile
   */
  async getOrCreatePrimaryProfile(): Promise<Profile> {
    const cacheKey = getCacheKey(`${this.baseUrl}/me`);
    
    // Check cache first
    const cachedData = getCacheEntry<Profile>(cacheKey);
    if (cachedData) {
      console.log('ProfileService: Returning cached profile data');
      return cachedData;
    }

    console.log('ProfileService: Fetching fresh profile data from server');
    const response = await api.get(`${this.baseUrl}/me`);
    const profile = response.data.data;
    
    console.log('ProfileService: Received profile data:', profile);
    
    // Cache the result
    setCacheEntry(cacheKey, profile, 10 * 60 * 1000); // Cache for 10 minutes
    
    return profile;
  }

  /**
   * Get all profiles for the current user
   */
  async getUserProfiles(): Promise<Profile[]> {
    const cacheKey = getCacheKey(`${this.baseUrl}/me/all`);
    const cached = getCacheEntry<Profile[]>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const response = await api.get(`${this.baseUrl}/me/all`);
      const profiles = response.data.data;
      setCacheEntry(cacheKey, profiles, 300000);
      return profiles;
    } catch (error) {
      console.error('Error getting user profiles:', error);
      throw error;
    }
  }

  /**
   * Get profile by type
   */
  async getProfileByType(profileType: 'personal' | 'roommate' | 'agency'): Promise<Profile> {
    const cacheKey = getCacheKey(`${this.baseUrl}/me/${profileType}`);
    const cached = getCacheEntry<Profile>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const response = await api.get(`${this.baseUrl}/me/${profileType}`);
      const profile = response.data.data;
      setCacheEntry(cacheKey, profile, 300000);
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

      // Clear all related caches to ensure fresh data
      console.log('ProfileService: Clearing all related caches');
      clearCache(`${this.baseUrl}/me`);
      clearCache(`${this.baseUrl}/me/all`);
      clearCache(`${this.baseUrl}/${updatedProfile.id}`);
      clearCache(`${this.baseUrl}/${updatedProfile._id}`);

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
      value
    });
    
    // Update cache
    const cacheKey = getCacheKey(`${this.baseUrl}/me`);
    setCacheEntry(cacheKey, response.data.data);
    
    return response.data.data;
  }

  /**
   * Recalculate primary profile trust score
   */
  async recalculatePrimaryTrustScore(): Promise<{ profile: Profile; trustScore: any }> {
    const response = await api.post(`${this.baseUrl}/me/trust-score/recalculate`);
    
    // Update cache
    const cacheKey = getCacheKey(`${this.baseUrl}/me`);
    setCacheEntry(cacheKey, response.data.data.profile);
    
    return response.data.data;
  }

  /**
   * Update profile
   */
  async updateProfile(profileId: string, updateData: UpdateProfileData): Promise<Profile> {
    try {
      const response = await api.put(`${this.baseUrl}/${profileId}`, updateData);
      const updatedProfile = response.data.data;

      // If this profile was fetched earlier, update or invalidate cache
      const cacheKey = getCacheKey(`${this.baseUrl}/${profileId}`);
      setCacheEntry(cacheKey, updatedProfile);

      // Also clear related caches so next fetch gets fresh data
      clearCache(`${this.baseUrl}/me`);
      clearCache(`${this.baseUrl}/me/all`);

      return updatedProfile;
    } catch (error) {
      console.error('Error updating profile:', error);
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
    const cacheKey = getCacheKey(`${this.baseUrl}/me/agency-memberships`);
    const cached = getCacheEntry<Profile[]>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const response = await api.get(`${this.baseUrl}/me/agency-memberships`);
      const memberships = response.data.data;
      setCacheEntry(cacheKey, memberships, 300000);
      return memberships;
    } catch (error) {
      console.error('Error getting agency memberships:', error);
      throw error;
    }
  }

  /**
   * Add member to agency profile
   */
  async addAgencyMember(profileId: string, memberOxyUserId: string, role: 'owner' | 'admin' | 'agent' | 'viewer'): Promise<Profile> {
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
}

export default new ProfileService(); 