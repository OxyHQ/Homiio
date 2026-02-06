const { Profile } = require("../models");
const { successResponse } = require("../middlewares/errorHandler");
const { ProfileType, EmploymentStatus, LeaseDuration } = require("@homiio/shared-types");
const { Saved, SavedPropertyFolder, SavedSearch, RecentlyViewed, Property } = require("../models");

// Create a simple errorResponse function since it's not exported from errorHandler
const errorResponse = (message = 'Error occurred', code = 'ERROR') => {
  return {
    success: false,
    message,
    code,
    timestamp: new Date().toISOString()
  };
};

// Simple in-memory cache for profile data
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 1000;
const profileCache = new Map<string, { data: any; timestamp: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of profileCache) {
    if (now - entry.timestamp >= CACHE_TTL) profileCache.delete(key);
  }
}, 60_000).unref();

class ProfileController {
  constructor() {
    // Bind methods to preserve 'this' context
    this.getOrCreateActiveProfile = this.getOrCreateActiveProfile.bind(this);
    this.getUserProfiles = this.getUserProfiles.bind(this);
    this.getProfileByType = this.getProfileByType.bind(this);
    this.createProfile = this.createProfile.bind(this);
    this.updateProfile = this.updateProfile.bind(this);
    this.deleteProfile = this.deleteProfile.bind(this);
    this.getAgencyMemberships = this.getAgencyMemberships.bind(this);
    this.addAgencyMember = this.addAgencyMember.bind(this);
    this.removeAgencyMember = this.removeAgencyMember.bind(this);
    this.updateActiveProfile = this.updateActiveProfile.bind(this);
    this.updateActiveTrustScore = this.updateActiveTrustScore.bind(this);
    this.updateTrustScore = this.updateTrustScore.bind(this);
    this.getTrustScore = this.getTrustScore.bind(this);
    this.recalculateActiveTrustScore = this.recalculateActiveTrustScore.bind(this);
    this.activateProfile = this.activateProfile.bind(this);
    this.getProfileById = this.getProfileById.bind(this);
    this.test = this.test.bind(this);
    this.getProfileProperties = this.getProfileProperties.bind(this);
    this.getRecentProperties = this.getRecentProperties.bind(this);
    this.getSavedProperties = this.getSavedProperties.bind(this);
    this.saveProperty = this.saveProperty.bind(this);
    this.unsaveProperty = this.unsaveProperty.bind(this);
    this.updateSavedPropertyNotes = this.updateSavedPropertyNotes.bind(this);
    this.getSavedPropertyFolders = this.getSavedPropertyFolders.bind(this);
    this.createSavedPropertyFolder = this.createSavedPropertyFolder.bind(this);
    this.updateSavedPropertyFolder = this.updateSavedPropertyFolder.bind(this);
    this.deleteSavedPropertyFolder = this.deleteSavedPropertyFolder.bind(this);
    this.trackPropertyView = this.trackPropertyView.bind(this);
    this.clearRecentProperties = this.clearRecentProperties.bind(this);
    this.debugRecentProperties = this.debugRecentProperties.bind(this);
    this.getSavedSearches = this.getSavedSearches.bind(this);
    this.saveSearch = this.saveSearch.bind(this);
    this.deleteSavedSearch = this.deleteSavedSearch.bind(this);
    this.updateSavedSearch = this.updateSavedSearch.bind(this);
    this.toggleSearchNotifications = this.toggleSearchNotifications.bind(this);
    this.saveProfile = this.saveProfile.bind(this);
    this.unsaveProfile = this.unsaveProfile.bind(this);
    this.isProfileSaved = this.isProfileSaved.bind(this);
  }

  /**
   * Internal: extract oxyUserId from request safely
   */
  _getOxyUserId(req: any): string | undefined {
    return req?.user?.id || req?.user?._id;
  }

  /**
   * Internal: create and activate a minimal personal profile for a user.
   * Centralized to avoid duplicating defaults across endpoints.
   * Only used when explicitly creating or ensuring an active profile.
   */
  async _createDefaultPersonalProfile(oxyUserId: string) {
    const personal = new Profile({
      oxyUserId,
      profileType: ProfileType.PERSONAL,
      isActive: true,
      isPrimary: true,
      personalProfile: {
        personalInfo: {
          bio: "",
          occupation: "",
          employer: "",
          annualIncome: null,
          employmentStatus: null,
          moveInDate: null,
          leaseDuration: null,
        },
        preferences: {},
        references: [],
        rentalHistory: [],
        verification: {},
        trustScore: { score: 50, factors: [] },
        settings: {
          notifications: { email: true, push: true, sms: false },
          privacy: { profileVisibility: "public", showContactInfo: true, showIncome: false },
          language: "en",
          timezone: "UTC",
        },
      },
    });
    personal.calculateTrustScore?.();
    await personal.save();
    return personal;
  }

  /**
   * Save (follow) a profile for the current user's active profile
   */
  async saveProfile(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileId } = req.body;
      if (!oxyUserId) {
        return res.status(401).json(errorResponse("Authentication required", "AUTHENTICATION_REQUIRED"));
      }
      if (!profileId) {
        return res.status(400).json(errorResponse("Profile ID is required", "PROFILE_ID_REQUIRED"));
      }
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) {
        return res.status(404).json(errorResponse("Active profile not found", "ACTIVE_PROFILE_NOT_FOUND"));
      }
      await Saved.updateOne(
        { profileId: activeProfile._id, targetType: 'profile', targetId: profileId },
        { $set: { profileId: activeProfile._id, targetType: 'profile', targetId: profileId, createdAt: new Date() } },
        { upsert: true }
      );
      return res.json(successResponse({}, "Profile saved"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Unsave (unfollow) a profile
   */
  async unsaveProfile(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileId } = req.params;
      if (!oxyUserId) {
        return res.status(401).json(errorResponse("Authentication required", "AUTHENTICATION_REQUIRED"));
      }
      if (!profileId) {
        return res.status(400).json(errorResponse("Profile ID is required", "PROFILE_ID_REQUIRED"));
      }
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) {
        return res.status(404).json(errorResponse("Active profile not found", "ACTIVE_PROFILE_NOT_FOUND"));
      }
      await Saved.deleteOne({ profileId: activeProfile._id, targetType: 'profile', targetId: profileId });
      return res.json(successResponse({}, "Profile unsaved"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check if a profile is saved (followed) by current user's active profile
   */
  async isProfileSaved(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileId } = req.params;
      if (!oxyUserId) {
        return res.status(401).json(errorResponse("Authentication required", "AUTHENTICATION_REQUIRED"));
      }
      if (!profileId) {
        return res.status(400).json(errorResponse("Profile ID is required", "PROFILE_ID_REQUIRED"));
      }
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) {
        return res.json(successResponse({ saved: false }, "No active profile"));
      }
      const exists = await Saved.findOne({ profileId: activeProfile._id, targetType: 'profile', targetId: profileId }).lean();
      return res.json(successResponse({ saved: !!exists }, "Saved status"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get cache key for profile
   */
  getCacheKey(oxyUserId, type = 'active') {
    return `${oxyUserId}:${type}`;
  }

  /**
   * Get cached profile data
   */
  getCachedProfile(oxyUserId, type = 'active') {
    const key = this.getCacheKey(oxyUserId, type);
    const cached = profileCache.get(key);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    return null;
  }

  /**
   * Set cached profile data
   */
  setCachedProfile(oxyUserId, data, type = 'active') {
    const key = this.getCacheKey(oxyUserId, type);
    profileCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Clear cached profile data
   */
  clearCachedProfile(oxyUserId, type = 'active') {
    const key = this.getCacheKey(oxyUserId, type);
    profileCache.delete(key);
  }

  /**
   * Test endpoint to check if the controller is working
   */
  async test(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;

      res.json({
        success: true,
        message: 'Profile controller is working',
        oxyUserId,
        hasUser: !!req.user,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get or create user's active profile
   */
  async getOrCreateActiveProfile(req: any, res: any, next: any) {
    try {
      const oxyUserId = this._getOxyUserId(req);

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

  // Check cache first
      let profile = this.getCachedProfile(oxyUserId, 'active');

      if (!profile) {
        // Try to find existing active profile
        profile = await Profile.findActiveByOxyUserId(oxyUserId);

        if (!profile) {
          // Check if there's a personal profile (even if not active)
          const personalProfile = await Profile.findOne({ oxyUserId, profileType: ProfileType.PERSONAL });

          if (personalProfile) {
            // Make personal profile active but don't change active status
            personalProfile.isActive = true;
            await personalProfile.save();

            // Clear cache after making profile active
            this.clearCachedProfile(oxyUserId, 'active');

            profile = personalProfile;
          } else {
    const defaultPersonalProfile = await this._createDefaultPersonalProfile(oxyUserId);
    // Clear cache after creating new profile
    this.clearCachedProfile(oxyUserId, 'active');
    profile = defaultPersonalProfile;
          }
        } else {
          // Always return full profile data unless explicitly requesting minimal
          const minimal = req.query.minimal === 'true';
          if (!minimal) {
            profile = await Profile.findById(profile._id);
          }
        }

        // Cache the result
        this.setCachedProfile(oxyUserId, profile, 'active');
      }

      res.json(
        successResponse(profile, "Profile retrieved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all profiles for a user
   */
  async getUserProfiles(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get all profiles including profile-specific data for display
      const profiles = await Profile.findByOxyUserId(oxyUserId);

      res.json(
        successResponse(profiles, "Profiles retrieved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get profile by type
   */
  async getProfileByType(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileType } = req.params;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!Object.values(ProfileType).includes(profileType)) {
        return res.status(400).json(
          errorResponse("Invalid profile type", "INVALID_PROFILE_TYPE")
        );
      }

      const profile = await Profile.findByOxyUserIdAndType(oxyUserId, profileType);

      if (!profile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      res.json(
        successResponse(profile, "Profile retrieved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new profile
   */
  async createProfile(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      let { profileType, data, isPersonalProfile } = req.body as any;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Support legacy flag from frontend service
      if (!profileType && isPersonalProfile === true) {
        profileType = ProfileType.PERSONAL;
      }

      if (!Object.values(ProfileType).includes(profileType)) {
        return res.status(400).json(
          errorResponse("Invalid profile type", "INVALID_PROFILE_TYPE")
        );
      }

  // Allow multiple profiles for AGENCY/BUSINESS/COOPERATIVE.
  // Uniqueness is enforced only for PERSONAL profiles below.

      // Special handling for personal profiles - only one allowed per user
      if (profileType === ProfileType.PERSONAL) {
        const existingPersonalProfile = await Profile.findOne({
          oxyUserId,
          profileType: ProfileType.PERSONAL,
        });
        if (existingPersonalProfile) {
          return res.status(409).json(
            errorResponse(
              "Personal profile already exists for this user. Only one personal profile is allowed per user.",
              "PERSONAL_PROFILE_ALREADY_EXISTS",
            ),
          );
        }
        // Create default personal profile or merge provided data
        const profile = await this._createDefaultPersonalProfile(oxyUserId);
        if (data && typeof data === 'object') {
          // Merge any provided partials
          profile.personalProfile = {
            ...profile.personalProfile,
            ...data,
            personalInfo: { ...profile.personalProfile?.personalInfo, ...data.personalInfo },
            settings: { ...profile.personalProfile?.settings, ...data.settings },
          } as any;
          profile.calculateTrustScore?.();
          await profile.save();
        }
        // Clear cache after creating new profile
        this.clearCachedProfile(oxyUserId, 'active');
        return res.status(201).json(successResponse(profile, "Profile created successfully"));
      }

      // Normalize payload
      if (!data || typeof data !== 'object') data = {};
      if (data && typeof data === 'object' && data.businessDetails && typeof data.businessDetails === 'object') {
        // Coerce empty strings to undefined by deleting them so enums don't get ''
        if (data.businessDetails.employeeCount === '') delete data.businessDetails.employeeCount;
        if (data.businessDetails.yearEstablished === '' || data.businessDetails.yearEstablished === null) delete data.businessDetails.yearEstablished;
        if (data.businessDetails.licenseNumber === '') delete data.businessDetails.licenseNumber;
        if (data.businessDetails.taxId === '') delete data.businessDetails.taxId;
      }

      // For business/agency types, ensure businessType provided
      if ([ProfileType.AGENCY, ProfileType.BUSINESS].includes(profileType) && !data.businessType) {
        return res.status(400).json(
          errorResponse("'businessType' is required for this profile type", "BUSINESS_TYPE_REQUIRED")
        );
      }

      // Check if this is the user's first profile (no active profile exists)
      const existingActiveProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      const isFirstProfile = !existingActiveProfile;

      // Create profile based on type
      const profileData: any = {
        oxyUserId,
        profileType,
        isActive: true
      };

      switch (profileType) {
        case ProfileType.PERSONAL:
          profileData.personalProfile = {
            personalInfo: {
              bio: "",
              occupation: "",
              employer: "",
              annualIncome: null,
              employmentStatus: "employed",
              moveInDate: null,
              leaseDuration: "yearly",
            },
            preferences: data.preferences || {},
            references: data.references || [],
            rentalHistory: data.rentalHistory || [],
            verification: data.verification || {},
            trustScore: { score: 50, factors: [] },
            settings: data.settings || {
              notifications: { email: true, push: true, sms: false },
              privacy: { profileVisibility: "public", showContactInfo: true, showIncome: false },
              language: "en",
              timezone: "UTC"
            }
          };
          break;

        case ProfileType.AGENCY:
          profileData.agencyProfile = {
            businessType: data.businessType,
            legalCompanyName: data.legalCompanyName || "",
            description: data.description || "",
            businessDetails: data.businessDetails || {},
            verification: data.verification || {},
            ratings: { average: 0, count: 0 },
            members: [{
              oxyUserId,
              role: "owner",
              addedAt: new Date()
            }]
          };
          break;

        case ProfileType.BUSINESS:
          profileData.businessProfile = {
            businessType: data.businessType,
            legalCompanyName: data.legalCompanyName || "",
            description: data.description || "",
            businessDetails: data.businessDetails || {},
            verification: data.verification || {},
            ratings: { average: 0, count: 0 }
          };
          break;
        case ProfileType.COOPERATIVE:
          profileData.cooperativeProfile = {
            legalName: data.legalName || "",
            description: data.description || "",
            members: [{
              oxyUserId,
              role: "owner",
              addedAt: new Date()
            }]
          };
          break;
      }

  const profile = new Profile(profileData);

      // Calculate initial trust score for personal profiles
      if (profileType === ProfileType.PERSONAL) {
        profile.calculateTrustScore();
      }

      await profile.save();

      // Clear cache after creating new profile
      this.clearCachedProfile(oxyUserId, 'active');

  res.status(201).json(
        successResponse(profile, "Profile created successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update profile
   */
  async updateProfile(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileId } = req.params;
      const updateData = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      const profile = await Profile.findById(profileId);

      if (!profile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      if (profile.oxyUserId !== oxyUserId) {
        return res.status(403).json(
          errorResponse("Access denied", "ACCESS_DENIED")
        );
      }

      // If activating this profile, deactivate all others for this user
      if (updateData.isActive === true) {
        // Use the new activateProfile method for better consistency
        await Profile.activateProfile(oxyUserId, profile._id);
        // Clear the cached active profile since we just changed which profile is active
        this.clearCachedProfile(oxyUserId, 'active');
        // Update the profile object to reflect the changes
        profile.isActive = true;
      } else {
        // Update profile data
        Object.keys(updateData).forEach(key => {
          if (key === "personalProfile" || key === "agencyProfile" || key === "businessProfile") {
            profile[key] = { ...profile[key], ...updateData[key] };
          } else {
            profile[key] = updateData[key];
          }
        });

        // Recalculate trust score for personal profiles
        if (profile.profileType === ProfileType.PERSONAL) {
          profile.calculateTrustScore();
        }

        await profile.save();
      }

      // Clear cache after update
      this.clearCachedProfile(oxyUserId, 'active');

      res.json(
        successResponse(profile, "Profile updated successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete profile
   */
  async deleteProfile(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileId } = req.params;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      const profile = await Profile.findById(profileId);

      if (!profile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      if (profile.oxyUserId !== oxyUserId) {
        return res.status(403).json(
          errorResponse("Access denied", "ACCESS_DENIED")
        );
      }

      if (profile.isActive) {
        return res.status(400).json(
          errorResponse("Cannot delete active profile", "CANNOT_DELETE_ACTIVE")
        );
      }

      // Prevent deletion of personal profiles as they are linked to the Oxy account
      if (profile.profileType === ProfileType.PERSONAL) {
        return res.status(400).json(
          errorResponse("Cannot delete personal profile as it is linked to your Oxy account", "CANNOT_DELETE_PERSONAL")
        );
      }

      await Profile.findByIdAndDelete(profileId);

      // Clear cache after deleting profile
      this.clearCachedProfile(oxyUserId, 'active');
      this.clearCachedProfile(oxyUserId, profileId);

      res.json(
        successResponse({ profileId }, "Profile deleted successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get agency memberships for a user
   */
  async getAgencyMemberships(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      const memberships = await Profile.findAgencyMemberships(oxyUserId);

      res.json(
        successResponse(memberships, "Agency memberships retrieved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add member to agency profile
   */
  async addAgencyMember(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileId } = req.params;
      const { memberOxyUserId, role } = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      const profile = await Profile.findById(profileId);

      if (!profile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      if (profile.profileType !== ProfileType.AGENCY) {
        return res.status(400).json(
          errorResponse("Can only add members to agency profiles", "INVALID_PROFILE_TYPE")
        );
      }

      const userMember = profile.agencyProfile.members.find(m => m.oxyUserId === oxyUserId);
      if (!userMember || !["owner", "admin"].includes(userMember.role)) {
        return res.status(403).json(
          errorResponse("Insufficient permissions", "INSUFFICIENT_PERMISSIONS")
        );
      }

      await profile.addAgencyMember(memberOxyUserId, role, oxyUserId);

      res.json(
        successResponse(profile, "Member added successfully")
      );
    } catch (error) {
      if (error.message === "Member already exists in this agency") {
        return res.status(409).json(
          errorResponse(error.message, "MEMBER_ALREADY_EXISTS")
        );
      }
      next(error);
    }
  }

  /**
   * Remove member from agency profile
   */
  async removeAgencyMember(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileId, memberOxyUserId } = req.params;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      const profile = await Profile.findById(profileId);

      if (!profile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      if (profile.profileType !== ProfileType.AGENCY) {
        return res.status(400).json(
          errorResponse("Can only remove members from agency profiles", "INVALID_PROFILE_TYPE")
        );
      }

      const userMember = profile.agencyProfile.members.find(m => m.oxyUserId === oxyUserId);
      if (!userMember || !["owner", "admin"].includes(userMember.role)) {
        return res.status(403).json(
          errorResponse("Insufficient permissions", "INSUFFICIENT_PERMISSIONS")
        );
      }

      const targetMember = profile.agencyProfile.members.find(m => m.oxyUserId === memberOxyUserId);
      if (targetMember && targetMember.role === "owner") {
        return res.status(400).json(
          errorResponse("Cannot remove agency owner", "CANNOT_REMOVE_OWNER")
        );
      }

      await profile.removeAgencyMember(memberOxyUserId);

      res.json(
        successResponse(profile, "Member removed successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update active profile (no profile ID needed)
   */
  async updateActiveProfile(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const updateData = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Find the active profile for this user (non-lean for updates)
      const profile = await Profile.findOne({
        oxyUserId,
        isActive: true
      });

      if (!profile) {
        return res.status(404).json(
          errorResponse("Active profile not found", "PROFILE_NOT_FOUND")
        );
      }

      // If activating this profile, deactivate all others for this user
      if (updateData.isActive === true) {
        // Use the new activateProfile method for better consistency
        await Profile.activateProfile(oxyUserId, profile._id);
        // Clear the cached active profile since we just changed which profile is active
        this.clearCachedProfile(oxyUserId, 'active');
        // Update the profile object to reflect the changes
        profile.isActive = true;
      } else {
        // Update the profile
        if (updateData.personalProfile) {
          profile.personalProfile = {
            ...profile.personalProfile,
            ...updateData.personalProfile
          };
        }

        if (updateData.agencyProfile) {
          profile.agencyProfile = {
            ...profile.agencyProfile,
            ...updateData.agencyProfile
          };
        }

        if (updateData.businessProfile) {
          profile.businessProfile = {
            ...profile.businessProfile,
            ...updateData.businessProfile
          };
        }

        // Recalculate trust score for personal profiles
        if (profile.profileType === ProfileType.PERSONAL) {
          profile.calculateTrustScore();
        }

        await profile.save();
      }

      // Clear cache after update
      this.clearCachedProfile(oxyUserId, 'active');

      res.json(
        successResponse(profile, "Active profile updated successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update active profile trust score (no profile ID needed)
   */
  async updateActiveTrustScore(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { factor, value } = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Find the active profile for this user (non-lean for updates)
      const profile = await Profile.findOne({
        oxyUserId,
        isActive: true
      });

      if (!profile) {
        return res.status(404).json(
          errorResponse("Active profile not found", "PROFILE_NOT_FOUND")
        );
      }

      if (profile.profileType !== ProfileType.PERSONAL) {
        return res.status(400).json(
          errorResponse("Can only update trust score for personal profiles", "INVALID_PROFILE_TYPE")
        );
      }

  await profile.updateTrustScore(factor, value);

  // Invalidate trust score cache
  this.clearCachedProfile(oxyUserId, 'trustScore');

      res.json(
        successResponse(profile, "Trust score updated successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update trust score
   */
  async updateTrustScore(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileId } = req.params;
      const { factor, value } = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      const profile = await Profile.findById(profileId);

      if (!profile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      if (profile.oxyUserId !== oxyUserId) {
        return res.status(403).json(
          errorResponse("Access denied", "ACCESS_DENIED")
        );
      }

      if (profile.profileType !== ProfileType.PERSONAL) {
        return res.status(400).json(
          errorResponse("Can only update trust score for personal profiles", "INVALID_PROFILE_TYPE")
        );
      }

  await profile.updateTrustScore(factor, value);

  // Invalidate trust score cache
  this.clearCachedProfile(oxyUserId, 'trustScore');

      res.json(
        successResponse(profile, "Trust score updated successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get trust score only (optimized for performance)
   */
  async getTrustScore(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Check cache first
      const cached = this.getCachedProfile(oxyUserId, 'trustScore');
      if (cached) {
        return res.json(successResponse(cached, "Trust score retrieved successfully"));
      }

      // Get only the trust score data
      const profile = await Profile.findActiveByOxyUserId(
        oxyUserId,
        'personalProfile.trustScore profileType'
      );

      if (!profile || profile.profileType !== ProfileType.PERSONAL) {
        return res.status(404).json(
          errorResponse("Personal profile not found", "PROFILE_NOT_FOUND")
        );
      }

      const trustScore = profile.personalProfile?.trustScore || { score: 0, factors: [] };

      // Cache the result
      this.setCachedProfile(oxyUserId, trustScore, 'trustScore');

      res.json(
        successResponse(trustScore, "Trust score retrieved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Recalculate trust score for active profile
   */
  async recalculateActiveTrustScore(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Find the active profile for this user (non-lean for method calls)
      const profile = await Profile.findOne({
        oxyUserId,
        isActive: true
      });

      if (!profile) {
        return res.status(404).json(
          errorResponse("Active profile not found", "PROFILE_NOT_FOUND")
        );
      }

      if (profile.profileType !== ProfileType.PERSONAL) {
        return res.status(400).json(
          errorResponse("Can only recalculate trust score for personal profiles", "INVALID_PROFILE_TYPE")
        );
      }

      // Calculate trust score
      const trustScoreData = profile.calculateTrustScore();
      await profile.save();

      res.json(
        successResponse({
          profile,
          trustScore: trustScoreData
        }, "Trust score recalculated successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Activate a specific profile
   */
  async activateProfile(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileId } = req.params;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      const profile = await Profile.findById(profileId);

      if (!profile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      if (profile.oxyUserId !== oxyUserId) {
        return res.status(403).json(
          errorResponse("Access denied", "ACCESS_DENIED")
        );
      }

      if (profile.isActive) {
        return res.status(400).json(
          errorResponse("Cannot activate active profile", "CANNOT_ACTIVATE_ACTIVE")
        );
      }

      await Profile.activateProfile(oxyUserId, profile._id);

      // Clear the cached active profile since we just changed which profile is active
      this.clearCachedProfile(oxyUserId, 'active');

      res.json(
        successResponse(profile, "Profile activated successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get profile by ID
   */
  async getProfileById(req: any, res: any, next: any) {
    try {
      const { profileId } = req.params;

      if (!profileId) {
        return res.status(400).json(
          errorResponse("Profile ID is required", "PROFILE_ID_REQUIRED")
        );
      }

      const profile = await Profile.findById(profileId);

      if (!profile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      res.json(
        successResponse(profile, "Profile retrieved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get properties for the current user's profile
   */
  async getProfileProperties(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { page = 1, limit = 10 } = req.query;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.json(
          successResponse({
            properties: [],
            total: 0,
            page: parseInt(page),
            totalPages: 0
          }, "No profile found for user")
        );
      }

      // Query database for user's properties using profileId
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [properties, total] = await Promise.all([
        Property.find({ profileId: activeProfile._id, status: { $ne: 'archived' } })
          .populate('addressId')
          .skip(skip)
          .limit(parseInt(limit))
          .sort({ createdAt: -1 })
          .lean(),
        Property.countDocuments({ profileId: activeProfile._id, status: { $ne: 'archived' } })
      ]);

      const totalPages = Math.ceil(total / parseInt(limit));

      res.json(
        successResponse({
          properties,
          total,
          page: parseInt(page),
          totalPages
        }, "Properties retrieved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get recently viewed properties for the current user's profile
   */
  async getRecentProperties(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { limit = 10 } = req.query;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
  let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.status(404).json(errorResponse("Active profile not found", "ACTIVE_PROFILE_NOT_FOUND"));
      }

      // Get recently viewed properties
      const recentViews = await RecentlyViewed.find({ profileId: activeProfile._id })
        .sort({ viewedAt: -1 })
        .limit(parseInt(limit))
        .populate({
          path: 'propertyId',
          populate: {
            path: 'addressId',
            model: 'Address'
          }
        })
        .lean();

      // Map and filter properties, ensuring no duplicates by property ID
      const propertiesMap = new Map();
      recentViews.forEach(view => {
        if (view.propertyId && view.propertyId._id) {
          const propertyId = view.propertyId._id.toString();
          // Only keep the most recent view for each property
          if (!propertiesMap.has(propertyId) || view.viewedAt > propertiesMap.get(propertyId).viewedAt) {
            propertiesMap.set(propertyId, {
              ...view.propertyId,
              viewedAt: view.viewedAt
            });
          }
        }
      });

      const properties = Array.from(propertiesMap.values());

      res.json(
        successResponse(properties, "Recent properties retrieved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get saved properties for the current user's profile
   */
  async getSavedProperties(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
  let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.json(successResponse([], "No profile found for user"));
      }

      // Use unified Saved collection
      const savedRows = await Saved.find({ profileId: activeProfile._id, targetType: 'property' })
        .sort({ createdAt: -1 })
        .lean();

      const propertyIds = savedRows.map((row: any) => row.targetId);
      const properties = await Property.find({ _id: { $in: propertyIds } }).populate('addressId').lean();

      // Map propertyId to doc for quick lookup
      const propById: Record<string, any> = {};
      properties.forEach((p: any) => { propById[String(p._id)] = p; });

      const merged = savedRows
        .map((row: any) => {
          const prop = propById[String(row.targetId)];
          if (!prop) return null;
          return {
            ...prop,
            savedAt: row.createdAt || row.updatedAt,
            notes: row.notes || '',
            folderId: row.folderId || null,
          };
        })
        .filter(Boolean);

      const response = successResponse(merged, "Saved properties retrieved successfully");

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get saved (followed) profiles for the current user's profile
   */
  async getSavedProfiles(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      if (!oxyUserId) {
        return res.status(401).json(errorResponse("Authentication required", "AUTHENTICATION_REQUIRED"));
      }
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) {
        return res.json(successResponse([] , "No profile found for user"));
      }
      const follows = await Saved.find({ profileId: activeProfile._id, targetType: 'profile' }).lean();
      const ids = follows.map(f => f.targetId);
      const profiles = await Profile.find({ _id: { $in: ids } }).lean();
      return res.json(successResponse(profiles, "Saved profiles retrieved"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Save a property for the current user's profile
   */
  async saveProperty(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { propertyId, notes, folderId } = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!propertyId) {
        return res.status(400).json(
          errorResponse("Property ID is required", "PROPERTY_ID_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) {
        return res.status(404).json(errorResponse("Active profile not found", "ACTIVE_PROFILE_NOT_FOUND"));
      }

      // Find or create default folder if no folderId provided
      let targetFolder;
      if (folderId) {
        // Verify the folder exists
        targetFolder = await SavedPropertyFolder.findOne({
          _id: folderId,
          profileId: activeProfile._id
        });

        if (!targetFolder) {
          return res.status(404).json(
            errorResponse("Folder not found", "FOLDER_NOT_FOUND")
          );
        }
      } else {
        // Find or create default folder
        targetFolder = await SavedPropertyFolder.findOne({
          profileId: activeProfile._id,
          isDefault: true
        });

        if (!targetFolder) {
          // Create default folder
          targetFolder = new SavedPropertyFolder({
            profileId: activeProfile._id,
            name: "Favorites",
            description: "Default folder for saved properties",
            icon: "❤️",
            isDefault: true,
            properties: []
          });
          await targetFolder.save();
        }
      }

      // Check if property is already saved
      const existingSaved = await Saved.findOne({ profileId: activeProfile._id, targetType: 'property', targetId: propertyId });

      // Upsert in unified Saved collection
      await Saved.updateOne(
        { profileId: activeProfile._id, targetType: 'property', targetId: propertyId },
        { $set: { profileId: activeProfile._id, targetType: 'property', targetId: propertyId, notes: notes || null, folderId: targetFolder?._id, createdAt: new Date() } },
        { upsert: true }
      );

      res.json(
        successResponse({ folderId: targetFolder?._id }, "Property saved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Unsave a property for the current user's profile
   */
  async unsaveProperty(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { propertyId } = req.params;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!propertyId) {
        return res.status(400).json(
          errorResponse("Property ID is required", "PROPERTY_ID_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        // If no active profile exists, there can't be any saved properties
        return res.status(404).json(
          errorResponse("Saved property not found", "SAVED_PROPERTY_NOT_FOUND")
        );
      }

      const result = await Saved.deleteOne({ profileId: activeProfile._id, targetType: 'property', targetId: propertyId });
      if (result.deletedCount === 0) {
        return res.status(404).json(errorResponse("Saved property not found", "SAVED_PROPERTY_NOT_FOUND"));
      }

      res.json(
        successResponse(null, "Property unsaved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update saved property notes for the current user's profile
   */
  async updateSavedPropertyNotes(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { propertyId } = req.params;
      const { notes } = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!propertyId) {
        return res.status(400).json(
          errorResponse("Property ID is required", "PROPERTY_ID_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        // If no active profile exists, there can't be any saved properties
        return res.status(404).json(
          errorResponse("Saved property not found", "SAVED_PROPERTY_NOT_FOUND")
        );
      }

      // Update notes on the saved record
      const updated = await Saved.findOneAndUpdate(
        { profileId: activeProfile._id, targetType: 'property', targetId: propertyId },
        { $set: { notes: notes || '' } },
        { new: true }
      );
      if (!updated) {
        return res.status(404).json(errorResponse("Saved property not found", "SAVED_PROPERTY_NOT_FOUND"));
      }

      // Best-effort: if property exists inside a folder's properties array, mirror notes there too
      try {
        const folder = await SavedPropertyFolder.findOne({
          profileId: activeProfile._id,
          'properties.propertyId': propertyId
        });
        if (folder) {
          const prop = folder.properties.find((p: any) => String(p.propertyId) === String(propertyId));
          if (prop) {
            prop.notes = notes || '';
            await folder.save();
          }
        }
      } catch (e) {
        // Non-fatal: failed to mirror notes to SavedPropertyFolder
      }
      res.json(successResponse(updated, "Property notes updated successfully"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get saved property folders for the current user's profile
   */
  async getSavedPropertyFolders(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      // Get all folders for this profile
      const folders = await SavedPropertyFolder.find({ profileId: activeProfile._id })
        .sort({ isDefault: -1, createdAt: 1 })
        .lean();

      // Calculate property count using unified Saved collection
      const folderIds = folders.map((f: any) => f._id);
      let countsByFolder: Record<string, number> = {};
      if (folderIds.length > 0) {
        const counts = await Saved.aggregate([
          { $match: { profileId: activeProfile._id, targetType: 'property', folderId: { $in: folderIds } } },
          { $group: { _id: '$folderId', count: { $sum: 1 } } },
        ]);
        countsByFolder = counts.reduce((acc: any, row: any) => {
          acc[String(row._id)] = row.count;
          return acc;
        }, {} as Record<string, number>);
      }

      const foldersWithCount = folders.map((folder: any) => ({
        ...folder,
        propertyCount: countsByFolder[String(folder._id)] || 0,
      }));

      res.json(
        successResponse({ folders: foldersWithCount }, "Saved property folders retrieved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new saved property folder
   */
  async createSavedPropertyFolder(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { name, description, color, icon } = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!name || !name.trim()) {
        return res.status(400).json(
          errorResponse("Folder name is required", "FOLDER_NAME_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      // Check if folder with same name already exists
      const existingFolder = await SavedPropertyFolder.findOne({
        profileId: activeProfile._id,
        name: { $regex: new RegExp(`^${name.trim()}$`, 'i') }
      });

      if (existingFolder) {
        return res.status(409).json(
          errorResponse("Folder with this name already exists", "FOLDER_NAME_EXISTS")
        );
      }

      // Create new folder
      const folder = new SavedPropertyFolder({
        profileId: activeProfile._id,
        name: name.trim(),
        description: description?.trim() || '',
        color: color || '#3B82F6',
        icon: icon || 'folder-outline',
        isDefault: false
      });

      await folder.save();

      res.status(201).json(
        successResponse(folder, "Folder created successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update a saved property folder
   */
  async updateSavedPropertyFolder(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { folderId } = req.params;
      const { name, description, color, icon } = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!folderId) {
        return res.status(400).json(
          errorResponse("Folder ID is required", "FOLDER_ID_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      // Find the folder
      const folder = await SavedPropertyFolder.findOne({
        _id: folderId,
        profileId: activeProfile._id
      });

      if (!folder) {
        return res.status(404).json(
          errorResponse("Folder not found", "FOLDER_NOT_FOUND")
        );
      }

      // Don't allow updating default folder
      if (folder.isDefault) {
        return res.status(400).json(
          errorResponse("Cannot update default folder", "CANNOT_UPDATE_DEFAULT_FOLDER")
        );
      }

      // Check if new name conflicts with existing folder
      if (name && name.trim() !== folder.name) {
        const existingFolder = await SavedPropertyFolder.findOne({
          profileId: activeProfile._id,
          name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
          _id: { $ne: folderId }
        });

        if (existingFolder) {
          return res.status(409).json(
            errorResponse("Folder with this name already exists", "FOLDER_NAME_EXISTS")
          );
        }
      }

      // Update folder
      const updateData: any = {};
      if (name) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description?.trim() || '';
      if (color) updateData.color = color;
      if (icon) updateData.icon = icon;

      const updatedFolder = await SavedPropertyFolder.findByIdAndUpdate(
        folderId,
        updateData,
        { new: true }
      );

      res.json(
        successResponse(updatedFolder, "Folder updated successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a saved property folder
   */
  async deleteSavedPropertyFolder(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { folderId } = req.params;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!folderId) {
        return res.status(400).json(
          errorResponse("Folder ID is required", "FOLDER_ID_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      // Find the folder
      const folder = await SavedPropertyFolder.findOne({
        _id: folderId,
        profileId: activeProfile._id
      });

      if (!folder) {
        return res.status(404).json(
          errorResponse("Folder not found", "FOLDER_NOT_FOUND")
        );
      }

      // Don't allow deleting default folder
      if (folder.isDefault) {
        return res.status(400).json(
          errorResponse("Cannot delete default folder", "CANNOT_DELETE_DEFAULT_FOLDER")
        );
      }

      // Move all properties in this folder to no folder (null) in unified Saved collection
      await Saved.updateMany(
        { profileId: activeProfile._id, targetType: 'property', folderId: folderId },
        { $set: { folderId: null } }
      );

      // Delete the folder
      await SavedPropertyFolder.findByIdAndDelete(folderId);

      res.json(
        successResponse(null, "Folder deleted successfully")
      );
    } catch (error) {
      next(error);
    }
  }



  /**
   * Track property view for the current user's profile
   */
  async trackPropertyView(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { propertyId } = req.params;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!propertyId) {
        return res.status(400).json(
          errorResponse("Property ID is required", "PROPERTY_ID_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.status(404).json(errorResponse("Active profile not found", "ACTIVE_PROFILE_NOT_FOUND"));
      }

      // Check if view already exists
      const existingView = await RecentlyViewed.findOne({
        profileId: activeProfile._id,
        propertyId
      });

      if (existingView) {
        // Update existing view timestamp
        existingView.viewedAt = new Date();
        await existingView.save();
      } else {
        // Create new view record
        const propertyView = new RecentlyViewed({
          profileId: activeProfile._id,
          propertyId,
          viewedAt: new Date()
        });
        await propertyView.save();
      }

      res.json(
        successResponse(null, "Property view tracked successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Clear recently viewed properties for the current user's profile
   */
  async clearRecentProperties(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.status(404).json(
          errorResponse("Profile not found", "PROFILE_NOT_FOUND")
        );
      }

      // Clear all recently viewed properties for this profile
      const result = await RecentlyViewed.deleteMany({
        profileId: activeProfile._id
      });

      res.json(
        successResponse({ deletedCount: result.deletedCount }, "Recently viewed properties cleared successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Debug endpoint to check recently viewed data
   */
  async debugRecentProperties(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.json(
          successResponse({
            error: "No active profile found",
            oxyUserId,
            debugInfo: "User needs to create a profile first"
          }, "Debug info retrieved")
        );
      }

      // Get recently viewed records WITHOUT population
      const rawRecentViews = await RecentlyViewed.find({ profileId: activeProfile._id })
        .sort({ viewedAt: -1 })
        .lean();

      // Get recently viewed records WITH population
      const populatedRecentViews = await RecentlyViewed.find({ profileId: activeProfile._id })
        .sort({ viewedAt: -1 })
        .populate({
          path: 'propertyId',
          populate: {
            path: 'addressId',
            model: 'Address'
          }
        })
        .lean();

      // Check if properties exist
      const propertyChecks = await Promise.all(
        rawRecentViews.map(async (view) => {
          const exists = await Property.findById(view.propertyId);
          return {
            propertyId: view.propertyId,
            exists: !!exists,
            propertyTitle: exists?.title || exists?.type || 'No title',
            propertyStatus: exists?.status || 'unknown'
          };
        })
      );

      // Get total count
      const totalCount = await RecentlyViewed.countDocuments({ profileId: activeProfile._id });

      res.json(
        successResponse({
          oxyUserId,
          profileId: activeProfile._id,
          profileType: activeProfile.profileType,
          totalCount,
          rawRecentViews: rawRecentViews.map(view => ({
            propertyId: view.propertyId,
            viewedAt: view.viewedAt,
            createdAt: view.createdAt,
            updatedAt: view.updatedAt
          })),
          populatedRecentViews: populatedRecentViews.map(view => ({
            propertyId: view.propertyId ? (typeof view.propertyId === 'object' ? view.propertyId._id : view.propertyId) : null,
            hasPopulatedProperty: !!view.propertyId && typeof view.propertyId === 'object',
            viewedAt: view.viewedAt,
            populatedKeys: view.propertyId && typeof view.propertyId === 'object' ? Object.keys(view.propertyId) : []
          })),
          propertyChecks
        }, "Debug info retrieved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get saved searches for the current user's profile
   */
  async getSavedSearches(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
  let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        // If user has no active profile, return empty list rather than creating data implicitly
        return res.json(successResponse([], "No profile found for user"));
      }

      // Get saved searches
      const savedSearches = await SavedSearch.find({ profileId: activeProfile._id })
        .sort({ createdAt: -1 })
        .lean();

      const response = successResponse(savedSearches, "Saved searches retrieved successfully");

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Save a search for the current user's profile
   */
  async saveSearch(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { name, query, filters, notificationsEnabled } = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!name || !query) {
        return res.status(400).json(
          errorResponse("Search name and query are required", "SEARCH_DATA_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) {
        return res.status(404).json(errorResponse("Active profile not found", "ACTIVE_PROFILE_NOT_FOUND"));
      }

      // Check if search with same name already exists
      const existingSearch = await SavedSearch.findOne({
        profileId: activeProfile._id,
        name: name.trim()
      });

      if (existingSearch) {
        return res.status(409).json(
          errorResponse("A search with this name already exists", "SEARCH_NAME_EXISTS")
        );
      }

      // Create new saved search
      const savedSearch = new SavedSearch({
        profileId: activeProfile._id,
        name: name.trim(),
        query: query.trim(),
        filters: filters || {},
        notificationsEnabled: !!notificationsEnabled,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await savedSearch.save();

      res.status(201).json(
        successResponse(savedSearch, "Search saved successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a saved search for the current user's profile
   */
  async deleteSavedSearch(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { searchId } = req.params;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!searchId) {
        return res.status(400).json(
          errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
        );
      }

      // Get the active profile for the current user
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.status(404).json(
          errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
        );
      }

      // Remove saved search
      const result = await SavedSearch.deleteOne({
        _id: searchId,
        profileId: activeProfile._id
      });

      if (result.deletedCount === 0) {
        return res.status(404).json(
          errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
        );
      }

      res.json(
        successResponse(null, "Search deleted successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update a saved search for the current user's profile
   */
  async updateSavedSearch(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { searchId } = req.params;
      const { name, query, filters, notificationsEnabled } = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!searchId) {
        return res.status(400).json(
          errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
        );
      }

      // Get the active profile for the current user
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.status(404).json(
          errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
        );
      }

      // Prepare update data
      const updateData: any = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name.trim();
      if (query !== undefined) updateData.query = query.trim();
      if (filters !== undefined) updateData.filters = filters;
      if (notificationsEnabled !== undefined) updateData.notificationsEnabled = !!notificationsEnabled;

      // Update saved search
      const savedSearch = await SavedSearch.findOneAndUpdate(
        { _id: searchId, profileId: activeProfile._id },
        updateData,
        { new: true }
      );

      if (!savedSearch) {
        return res.status(404).json(
          errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
        );
      }

      res.json(
        successResponse(savedSearch, "Search updated successfully")
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Toggle notifications for a saved search
   */
  async toggleSearchNotifications(req: any, res: any, next: any) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { searchId } = req.params;
      const { notificationsEnabled } = req.body;

      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      if (!searchId) {
        return res.status(400).json(
          errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
        );
      }

      // Get the active profile for the current user
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

      if (!activeProfile) {
        return res.status(404).json(
          errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
        );
      }

      // Update notifications setting
      const savedSearch = await SavedSearch.findOneAndUpdate(
        { _id: searchId, profileId: activeProfile._id },
        {
          notificationsEnabled: !!notificationsEnabled,
          updatedAt: new Date()
        },
        { new: true }
      );

      if (!savedSearch) {
        return res.status(404).json(
          errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
        );
      }

      res.json(
        successResponse(savedSearch, "Search notifications updated successfully")
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ProfileController();
