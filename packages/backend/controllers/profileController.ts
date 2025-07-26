const { Profile } = require("../models");
const { successResponse } = require("../middlewares/errorHandler");
const { ProfileType } = require("@homiio/shared-types");

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
const profileCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
    this.trackPropertyView = this.trackPropertyView.bind(this);
    this.clearRecentProperties = this.clearRecentProperties.bind(this);
    this.debugRecentProperties = this.debugRecentProperties.bind(this);
    this.getSavedSearches = this.getSavedSearches.bind(this);
    this.saveSearch = this.saveSearch.bind(this);
    this.deleteSavedSearch = this.deleteSavedSearch.bind(this);
    this.updateSavedSearch = this.updateSavedSearch.bind(this);
    this.toggleSearchNotifications = this.toggleSearchNotifications.bind(this);
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
  async test(req, res, next) {
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
      console.error("Error in test endpoint:", error);
      next(error);
    }
  }

  /**
   * Get or create user's active profile
   */
  async getOrCreateActiveProfile(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      
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
            profile = personalProfile;
          } else {
            // Create a default personal profile
            const defaultPersonalProfile = new Profile({
              oxyUserId,
              profileType: ProfileType.PERSONAL,
              isActive: true,
              isPrimary: true, // First profile is always primary
              personalProfile: {
                personalInfo: {
                  bio: "",
                  occupation: "",
                  employer: "",
                  annualIncome: null,
                  employmentStatus: "employed",
                  moveInDate: null,
                  leaseDuration: "yearly",
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
                  timezone: "UTC"
                }
              }
            });
            
            // Calculate initial trust score
            defaultPersonalProfile.calculateTrustScore();
            await defaultPersonalProfile.save();
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
      console.error("Error getting active profile:", error);
      next(error);
    }
  }

  /**
   * Get all profiles for a user
   */
  async getUserProfiles(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      
      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get profiles with basic fields only, but ensure toJSON transform works
      const profiles = await Profile.findByOxyUserId(oxyUserId, '_id oxyUserId profileType isActive createdAt updatedAt');
      
      res.json(
        successResponse(profiles, "Profiles retrieved successfully")
      );
    } catch (error) {
      console.error("Error getting user profiles:", error);
      next(error);
    }
  }

  /**
   * Get profile by type
   */
  async getProfileByType(req, res, next) {
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
      console.error("Error getting profile by type:", error);
      next(error);
    }
  }

  /**
   * Create a new profile
   */
  async createProfile(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { profileType, data } = req.body;
      
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

      // Check if profile of this type already exists
      const existingProfile = await Profile.findByOxyUserIdAndType(oxyUserId, profileType);
      if (existingProfile) {
        return res.status(409).json(
          errorResponse("Profile of this type already exists", "PROFILE_ALREADY_EXISTS")
        );
      }

      // Special handling for personal profiles - only one allowed per user
      if (profileType === ProfileType.PERSONAL) {
        const existingPersonalProfile = await Profile.findOne({ 
          oxyUserId, 
          profileType: ProfileType.PERSONAL 
        });
        if (existingPersonalProfile) {
          return res.status(409).json(
            errorResponse("Personal profile already exists for this user. Only one personal profile is allowed per user.", "PERSONAL_PROFILE_ALREADY_EXISTS")
          );
        }
        
        // Prevent manual creation of personal profiles - they should be created automatically
        return res.status(400).json(
          errorResponse("Personal profiles cannot be created manually. They are created automatically when you first access the system.", "PERSONAL_PROFILE_MANUAL_CREATION_NOT_ALLOWED")
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
      console.error("Error creating profile:", error);
      next(error);
    }
  }

  /**
   * Update profile
   */
  async updateProfile(req, res, next) {
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
      console.error("Error updating profile:", error);
      next(error);
    }
  }

  /**
   * Delete profile
   */
  async deleteProfile(req, res, next) {
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

      res.json(
        successResponse({ profileId }, "Profile deleted successfully")
      );
    } catch (error) {
      console.error("Error deleting profile:", error);
      next(error);
    }
  }

  /**
   * Get agency memberships for a user
   */
  async getAgencyMemberships(req, res, next) {
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
      console.error("Error getting agency memberships:", error);
      next(error);
    }
  }

  /**
   * Add member to agency profile
   */
  async addAgencyMember(req, res, next) {
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
      console.error("Error adding agency member:", error);
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
  async removeAgencyMember(req, res, next) {
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
      console.error("Error removing agency member:", error);
      next(error);
    }
  }

  /**
   * Update active profile (no profile ID needed)
   */
  async updateActiveProfile(req, res, next) {
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
      console.error("Error updating active profile:", error);
      next(error);
    }
  }

  /**
   * Update active profile trust score (no profile ID needed)
   */
  async updateActiveTrustScore(req, res, next) {
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

      res.json(
        successResponse(profile, "Trust score updated successfully")
      );
    } catch (error) {
      console.error("Error updating active trust score:", error);
      next(error);
    }
  }

  /**
   * Update trust score
   */
  async updateTrustScore(req, res, next) {
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

      res.json(
        successResponse(profile, "Trust score updated successfully")
      );
    } catch (error) {
      console.error("Error updating trust score:", error);
      next(error);
    }
  }

  /**
   * Get trust score only (optimized for performance)
   */
  async getTrustScore(req, res, next) {
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
      console.error("Error getting trust score:", error);
      next(error);
    }
  }

  /**
   * Recalculate trust score for active profile
   */
  async recalculateActiveTrustScore(req, res, next) {
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

      if (profile.profileType !== "personal") {
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
      console.error("Error recalculating active trust score:", error);
      next(error);
    }
  }

  /**
   * Activate a specific profile
   */
  async activateProfile(req, res, next) {
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

      res.json(
        successResponse(profile, "Profile activated successfully")
      );
    } catch (error) {
      console.error("Error activating profile:", error);
      next(error);
    }
  }

  /**
   * Get profile by ID
   */
  async getProfileById(req, res, next) {
    try {
      const { profileId } = req.params;
      
      console.log(`[getProfileById] Called for profileId: ${profileId}`, {
        hasUser: !!req.user,
        userId: req.userId,
        userFields: req.user ? Object.keys(req.user) : [],
        headers: {
          authorization: req.headers.authorization ? 'present' : 'missing'
        }
      });
      
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

      console.log(`[getProfileById] Found profile: ${profile._id}`, {
        profileType: profile.profileType,
        isActive: profile.isActive,
        oxyUserId: profile.oxyUserId
      });

      res.json(
        successResponse(profile, "Profile retrieved successfully")
      );
    } catch (error) {
      console.error("Error getting profile by ID:", error);
      next(error);
    }
  }

  /**
   * Get properties for the current user's profile
   */
  async getProfileProperties(req, res, next) {
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

          // Import Property
    const { Property } = require('../models');
      
      // Query database for user's properties using profileId
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [properties, total] = await Promise.all([
        Property.find({ profileId: activeProfile._id, status: { $ne: 'archived' } })
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
      console.error("Error getting profile properties:", error);
      next(error);
    }
  }

  /**
   * Get recently viewed properties for the current user's profile
   */
  async getRecentProperties(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { limit = 10 } = req.query;
      
      console.log(`[getRecentProperties] Called for oxyUserId: ${oxyUserId}, limit: ${limit}`);
      
      if (!oxyUserId) {
        console.log('[getRecentProperties] No oxyUserId found, returning 401');
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      
      console.log(`[getRecentProperties] Active profile lookup result:`, {
        found: !!activeProfile,
        profileId: activeProfile?._id,
        profileType: activeProfile?.profileType
      });
      
      if (!activeProfile) {
        console.log(`[getRecentProperties] No active profile found for user ${oxyUserId}, creating default personal profile`);
        // Create a default personal profile if none exists
        const defaultPersonalProfile = new Profile({
          oxyUserId,
          profileType: ProfileType.PERSONAL,
          isActive: true,
          isPrimary: true, // First profile is always primary
          personalProfile: {
            personalInfo: {
              bio: "",
              occupation: "",
              employer: "",
              annualIncome: null,
              employmentStatus: "employed",
              moveInDate: null,
              leaseDuration: "yearly",
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
              timezone: "UTC"
            }
          }
        });
        
        // Calculate initial trust score
        defaultPersonalProfile.calculateTrustScore();
        await defaultPersonalProfile.save();
        activeProfile = defaultPersonalProfile;
        
        console.log(`[getRecentProperties] Created new profile with ID: ${activeProfile._id}`);
      }

      // Import RecentlyViewed
      const { RecentlyViewed } = require('../models');
      
      console.log(`[getRecentProperties] Querying RecentlyViewed for profileId: ${activeProfile._id}`);
      
      // Get recently viewed properties
      const recentViews = await RecentlyViewed.find({ profileId: activeProfile._id })
        .sort({ viewedAt: -1 })
        .limit(parseInt(limit))
        .populate('propertyId')
        .lean();

      console.log(`[getRecentProperties] Found ${recentViews.length} recently viewed records`);
      
      // Debug: Log the raw recently viewed records
      recentViews.forEach((view, index) => {
        console.log(`[getRecentProperties] Record ${index}:`, {
          propertyId: view.propertyId ? (typeof view.propertyId === 'object' ? view.propertyId._id : view.propertyId) : 'null',
          hasPopulatedProperty: !!view.propertyId && typeof view.propertyId === 'object',
          viewedAt: view.viewedAt,
          populatedPropertyKeys: view.propertyId && typeof view.propertyId === 'object' ? Object.keys(view.propertyId) : 'none'
        });
      });

      const properties = recentViews.map(view => ({
        ...view.propertyId,
        viewedAt: view.viewedAt
      })).filter(item => item._id); // Filter out any null properties

      console.log(`[getRecentProperties] After mapping and filtering:`);
      properties.forEach((prop, index) => {
        console.log(`[getRecentProperties] Property ${index}:`, {
          hasProperty: !!prop,
          hasId: !!(prop._id || prop.id),
          propertyId: prop._id || prop.id || 'missing',
          keys: prop ? Object.keys(prop) : 'none'
        });
      });

      console.log(`[getRecentProperties] Returning ${properties.length} properties after filtering`);

      res.json(
        successResponse(properties, "Recent properties retrieved successfully")
      );
    } catch (error) {
      console.error("Error getting recent properties:", error);
      next(error);
    }
  }

  /**
   * Get saved properties for the current user's profile
   */
  async getSavedProperties(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      
      console.log('[getSavedProperties] Called with:', {
        hasUser: !!req.user,
        oxyUserId,
        userObject: req.user ? { id: req.user.id, _id: req.user._id } : null
      });
      
      if (!oxyUserId) {
        console.log('[getSavedProperties] No oxyUserId found, returning 401');
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      
      console.log('[getSavedProperties] Active profile search result:', {
        found: !!activeProfile,
        profileId: activeProfile?._id,
        profileType: activeProfile?.profileType
      });
      
      if (!activeProfile) {
        console.log(`[getSavedProperties] No active profile found for user ${oxyUserId}, creating default personal profile`);
        // Create a default personal profile if none exists
        const defaultPersonalProfile = new Profile({
          oxyUserId,
          profileType: ProfileType.PERSONAL,
          isActive: true,
          isPrimary: true, // First profile is always primary
          personalProfile: {
            personalInfo: {
              bio: "",
              occupation: "",
              employer: "",
              annualIncome: null,
              employmentStatus: "employed",
              moveInDate: null,
              leaseDuration: "yearly",
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
              timezone: "UTC"
            }
          }
        });
        
        // Calculate initial trust score
        defaultPersonalProfile.calculateTrustScore();
        await defaultPersonalProfile.save();
        activeProfile = defaultPersonalProfile;
        
        console.log('[getSavedProperties] Created new profile:', {
          profileId: activeProfile._id,
          profileType: activeProfile.profileType
        });
      }

      // Import SavedProperty
      const { SavedProperty } = require('../models');
      
      console.log('[getSavedProperties] Querying SavedProperty with profileId:', activeProfile._id);
      
      // Get saved properties
      const savedProperties = await SavedProperty.find({ profileId: activeProfile._id })
        .sort({ savedAt: -1 })
        .populate('propertyId')
        .lean();

      console.log('[getSavedProperties] SavedProperty query result:', {
        count: savedProperties.length,
        firstItem: savedProperties[0] ? {
          id: savedProperties[0]._id,
          propertyId: savedProperties[0].propertyId,
          hasPropertyId: !!savedProperties[0].propertyId,
          savedAt: savedProperties[0].savedAt
        } : null
      });

      const properties = savedProperties.map(saved => ({
        ...saved.propertyId,
        savedAt: saved.savedAt,
        notes: saved.notes
      })).filter(item => item._id); // Filter out any null properties

      console.log('[getSavedProperties] Mapped and filtered properties:', {
        originalCount: savedProperties.length,
        finalCount: properties.length,
        firstProperty: properties[0] ? {
          id: properties[0]._id,
          title: properties[0].title || 'No title',
          savedAt: properties[0].savedAt
        } : null
      });

      const response = successResponse(properties, "Saved properties retrieved successfully");
      
      console.log('[getSavedProperties] Final response:', {
        success: response.success,
        message: response.message,
        dataType: typeof response.data,
        dataLength: Array.isArray(response.data) ? response.data.length : 'not array',
        responseSize: JSON.stringify(response).length
      });

      res.json(response);
    } catch (error) {
      console.error("Error getting saved properties:", error);
      next(error);
    }
  }

  /**
   * Save a property for the current user's profile
   */
  async saveProperty(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { propertyId, notes } = req.body;
      
      console.log('saveProperty called:', { oxyUserId, propertyId, notes });
      
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
        console.log('No active profile found, creating one...');
        // Create a default personal profile if none exists
        const defaultPersonalProfile = new Profile({
          oxyUserId,
          profileType: ProfileType.PERSONAL,
          isActive: true,
          isPrimary: true, // First profile is always primary
          personalProfile: {
            personalInfo: {
              bio: "",
              occupation: "",
              employer: "",
              annualIncome: null,
              employmentStatus: "employed",
              moveInDate: null,
              leaseDuration: "yearly",
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
              timezone: "UTC"
            }
          }
        });
        
        // Calculate initial trust score
        defaultPersonalProfile.calculateTrustScore();
        await defaultPersonalProfile.save();
        activeProfile = defaultPersonalProfile;
      }

      // Import SavedProperty
      const { SavedProperty } = require('../models');
      
      // Check if property is already saved
      const existingSave = await SavedProperty.findOne({ 
        profileId: activeProfile._id, 
        propertyId 
      });

      if (existingSave) {
        // Update existing save with new notes if provided
        if (notes !== undefined) {
          existingSave.notes = notes;
          await existingSave.save();
        }
        
        return res.json(
          successResponse(existingSave, "Property already saved")
        );
      }

      // Create new saved property
      const savedProperty = new SavedProperty({
        profileId: activeProfile._id,
        propertyId,
        notes: notes || '',
        savedAt: new Date()
      });

      await savedProperty.save();

      res.json(
        successResponse(savedProperty, "Property saved successfully")
      );
    } catch (error) {
      console.error("Error saving property:", error);
      next(error);
    }
  }

  /**
   * Unsave a property for the current user's profile
   */
  async unsaveProperty(req, res, next) {
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

      // Import SavedProperty
      const { SavedProperty } = require('../models');
      
      // Remove saved property
      const result = await SavedProperty.deleteOne({ 
        profileId: activeProfile._id, 
        propertyId 
      });

      if (result.deletedCount === 0) {
        return res.status(404).json(
          errorResponse("Saved property not found", "SAVED_PROPERTY_NOT_FOUND")
        );
      }

      res.json(
        successResponse(null, "Property unsaved successfully")
      );
    } catch (error) {
      console.error("Error unsaving property:", error);
      next(error);
    }
  }

  /**
   * Update saved property notes for the current user's profile
   */
  async updateSavedPropertyNotes(req, res, next) {
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

      // Import SavedProperty
      const { SavedProperty } = require('../models');
      
      // Update saved property notes
      const savedProperty = await SavedProperty.findOneAndUpdate(
        { profileId: activeProfile._id, propertyId },
        { notes: notes || '' },
        { new: true }
      );

      if (!savedProperty) {
        return res.status(404).json(
          errorResponse("Saved property not found", "SAVED_PROPERTY_NOT_FOUND")
        );
      }

      res.json(
        successResponse(savedProperty, "Property notes updated successfully")
      );
    } catch (error) {
      console.error("Error updating saved property notes:", error);
      next(error);
    }
  }

  /**
   * Track property view for the current user's profile
   */
  async trackPropertyView(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { propertyId } = req.params;
      
      console.log(`[trackPropertyView] Called for user ${oxyUserId}, property ${propertyId}`);
      
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
        console.log(`[trackPropertyView] No active profile found for user ${oxyUserId}, creating default personal profile`);
        // Create a default personal profile if none exists
        const defaultPersonalProfile = new Profile({
          oxyUserId,
          profileType: ProfileType.PERSONAL,
          isActive: true,
          isPrimary: true, // First profile is always primary
          personalProfile: {
            personalInfo: {
              bio: "",
              occupation: "",
              employer: "",
              annualIncome: null,
              employmentStatus: "employed",
              moveInDate: null,
              leaseDuration: "yearly",
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
              timezone: "UTC"
            }
          }
        });
        
        // Calculate initial trust score
        defaultPersonalProfile.calculateTrustScore();
        await defaultPersonalProfile.save();
        activeProfile = defaultPersonalProfile;
        
        console.log(`[trackPropertyView] Created new profile with ID: ${activeProfile._id}`);
      }

      // Import RecentlyViewed
      const { RecentlyViewed } = require('../models');
      
      // Check if view already exists
      const existingView = await RecentlyViewed.findOne({ 
        profileId: activeProfile._id, 
        propertyId 
      });

      if (existingView) {
        // Update existing view timestamp
        existingView.viewedAt = new Date();
        await existingView.save();
        console.log(`[trackPropertyView] Updated existing view for property ${propertyId}`);
      } else {
        // Create new view record
        const propertyView = new RecentlyViewed({
          profileId: activeProfile._id,
          propertyId,
          viewedAt: new Date()
        });
        await propertyView.save();
        console.log(`[trackPropertyView] Created new view record for property ${propertyId}`);
      }

      res.json(
        successResponse(null, "Property view tracked successfully")
      );
    } catch (error) {
      console.error("Error tracking property view:", error);
      next(error);
    }
  }

  /**
   * Clear recently viewed properties for the current user's profile
   */
  async clearRecentProperties(req, res, next) {
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

      // Import RecentlyViewed
      const { RecentlyViewed } = require('../models');
      
      // Clear all recently viewed properties for this profile
      const result = await RecentlyViewed.deleteMany({ 
        profileId: activeProfile._id 
      });

      res.json(
        successResponse({ deletedCount: result.deletedCount }, "Recently viewed properties cleared successfully")
      );
    } catch (error) {
      console.error("Error clearing recent properties:", error);
      next(error);
    }
  }

  /**
   * Debug endpoint to check recently viewed data
   */
  async debugRecentProperties(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      
      console.log(`[debugRecentProperties] Called for oxyUserId: ${oxyUserId}`);
      
      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      
      console.log(`[debugRecentProperties] Active profile:`, {
        found: !!activeProfile,
        profileId: activeProfile?._id,
        profileType: activeProfile?.profileType
      });

      if (!activeProfile) {
        return res.json(
          successResponse({
            error: "No active profile found",
            oxyUserId,
            debugInfo: "User needs to create a profile first"
          }, "Debug info retrieved")
        );
      }

      // Import RecentlyViewed and Property
      const { RecentlyViewed, Property } = require('../models');
      
      // Get recently viewed records WITHOUT population
      const rawRecentViews = await RecentlyViewed.find({ profileId: activeProfile._id })
        .sort({ viewedAt: -1 })
        .lean();

      // Get recently viewed records WITH population
      const populatedRecentViews = await RecentlyViewed.find({ profileId: activeProfile._id })
        .sort({ viewedAt: -1 })
        .populate('propertyId')
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

      console.log(`[debugRecentProperties] Raw: ${rawRecentViews.length}, Populated: ${populatedRecentViews.length}, Total: ${totalCount}`);

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
      console.error("Error in debug recent properties:", error);
      next(error);
    }
  }

  /**
   * Get saved searches for the current user's profile
   */
  async getSavedSearches(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      
      console.log('[getSavedSearches] Called with:', {
        hasUser: !!req.user,
        oxyUserId,
        userObject: req.user ? { id: req.user.id, _id: req.user._id } : null
      });
      
      if (!oxyUserId) {
        console.log('[getSavedSearches] No oxyUserId found, returning 401');
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Get the active profile for the current user
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      
      console.log('[getSavedSearches] Active profile search result:', {
        found: !!activeProfile,
        profileId: activeProfile?._id,
        profileType: activeProfile?.profileType
      });
      
      if (!activeProfile) {
        console.log(`[getSavedSearches] No active profile found for user ${oxyUserId}, creating default personal profile`);
        // Create a default personal profile if none exists
        const defaultPersonalProfile = new Profile({
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
              employmentStatus: "employed",
              moveInDate: null,
              leaseDuration: "yearly",
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
              timezone: "UTC"
            }
          }
        });
        
        defaultPersonalProfile.calculateTrustScore();
        await defaultPersonalProfile.save();
        activeProfile = defaultPersonalProfile;
        
        console.log('[getSavedSearches] Created new profile:', {
          profileId: activeProfile._id,
          profileType: activeProfile.profileType
        });
      }

      // Import SavedSearchModel
      const { SavedSearch } = require('../models');
      
      console.log('[getSavedSearches] Querying SavedSearch with profileId:', activeProfile._id);
      
      // Get saved searches
      const savedSearches = await SavedSearch.find({ profileId: activeProfile._id })
        .sort({ createdAt: -1 })
        .lean();

      console.log('[getSavedSearches] SavedSearch query result:', {
        count: savedSearches.length,
        firstItem: savedSearches[0] ? {
          id: savedSearches[0]._id,
          name: savedSearches[0].name,
          query: savedSearches[0].query,
          createdAt: savedSearches[0].createdAt
        } : null
      });

      const response = successResponse(savedSearches, "Saved searches retrieved successfully");
      
      console.log('[getSavedSearches] Final response:', {
        success: response.success,
        message: response.message,
        dataLength: Array.isArray(response.data) ? response.data.length : 'not array'
      });

      res.json(response);
    } catch (error) {
      console.error("Error getting saved searches:", error);
      next(error);
    }
  }

  /**
   * Save a search for the current user's profile
   */
  async saveSearch(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { name, query, filters, notificationsEnabled } = req.body;
      
      console.log('saveSearch called:', { oxyUserId, name, query, filters, notificationsEnabled });
      
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
        console.log('No active profile found, creating one...');
        const defaultPersonalProfile = new Profile({
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
              employmentStatus: "employed",
              moveInDate: null,
              leaseDuration: "yearly",
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
              timezone: "UTC"
            }
          }
        });
        
        defaultPersonalProfile.calculateTrustScore();
        await defaultPersonalProfile.save();
        activeProfile = defaultPersonalProfile;
      }

      // Import SavedSearch
      const { SavedSearch } = require('../models');
      
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
      console.error("Error saving search:", error);
      next(error);
    }
  }

  /**
   * Delete a saved search for the current user's profile
   */
  async deleteSavedSearch(req, res, next) {
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

      // Import SavedSearch
      const { SavedSearch } = require('../models');
      
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
      console.error("Error deleting saved search:", error);
      next(error);
    }
  }

  /**
   * Update a saved search for the current user's profile
   */
  async updateSavedSearch(req, res, next) {
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

      // Import SavedSearch
      const { SavedSearch } = require('../models');
      
      // Prepare update data
      const updateData = { updatedAt: new Date() };
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
      console.error("Error updating saved search:", error);
      next(error);
    }
  }

  /**
   * Toggle notifications for a saved search
   */
  async toggleSearchNotifications(req, res, next) {
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

      // Import SavedSearch
      const { SavedSearch } = require('../models');
      
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
      console.error("Error toggling search notifications:", error);
      next(error);
    }
  }
}

module.exports = new ProfileController(); 