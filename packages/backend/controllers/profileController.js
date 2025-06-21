const { Profile } = require("../models");
const { successResponse, errorResponse } = require("../utils/helpers");

// Simple in-memory cache for profile data
const profileCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

class ProfileController {
  constructor() {
    // Bind methods to preserve 'this' context
    this.getOrCreatePrimaryProfile = this.getOrCreatePrimaryProfile.bind(this);
    this.getUserProfiles = this.getUserProfiles.bind(this);
    this.getProfileByType = this.getProfileByType.bind(this);
    this.createProfile = this.createProfile.bind(this);
    this.updateProfile = this.updateProfile.bind(this);
    this.deleteProfile = this.deleteProfile.bind(this);
    this.getAgencyMemberships = this.getAgencyMemberships.bind(this);
    this.addAgencyMember = this.addAgencyMember.bind(this);
    this.removeAgencyMember = this.removeAgencyMember.bind(this);
    this.updatePrimaryProfile = this.updatePrimaryProfile.bind(this);
    this.updatePrimaryTrustScore = this.updatePrimaryTrustScore.bind(this);
    this.updateTrustScore = this.updateTrustScore.bind(this);
    this.getTrustScore = this.getTrustScore.bind(this);
    this.recalculatePrimaryTrustScore = this.recalculatePrimaryTrustScore.bind(this);
  }

  /**
   * Get cache key for profile
   */
  getCacheKey(oxyUserId, type = 'primary') {
    return `${oxyUserId}:${type}`;
  }

  /**
   * Get cached profile data
   */
  getCachedProfile(oxyUserId, type = 'primary') {
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
  setCachedProfile(oxyUserId, data, type = 'primary') {
    const key = this.getCacheKey(oxyUserId, type);
    profileCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Clear cached profile data
   */
  clearCachedProfile(oxyUserId, type = 'primary') {
    const key = this.getCacheKey(oxyUserId, type);
    profileCache.delete(key);
  }

  /**
   * Get or create user's primary profile
   */
  async getOrCreatePrimaryProfile(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      
      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Check cache first
      let profile = this.getCachedProfile(oxyUserId, 'primary');
      
      if (!profile) {
        // Try to find existing primary profile
        profile = await Profile.findPrimaryByOxyUserId(oxyUserId);
        
        if (!profile) {
          // Create a new personal profile as primary
          const newProfile = new Profile({
            oxyUserId,
            profileType: "personal",
            isPrimary: true,
            personalProfile: {
              preferences: {},
              verification: {},
              trustScore: {
                score: 50,
                factors: []
              },
              settings: {
                notifications: {
                  email: true,
                  push: true,
                  sms: false
                },
                privacy: {
                  profileVisibility: "public",
                  showContactInfo: true,
                  showIncome: false
                },
                language: "en",
                timezone: "UTC"
              }
            }
          });
          
          await newProfile.save();
          
          // Fetch the complete profile after creation
          profile = await Profile.findById(newProfile._id);
        } else {
          // Always return full profile data unless explicitly requesting minimal
          const minimal = req.query.minimal === 'true';
          if (!minimal) {
            profile = await Profile.findById(profile._id);
          }
        }
        
        // Cache the result
        this.setCachedProfile(oxyUserId, profile, 'primary');
      }

      res.json(
        successResponse(profile, "Profile retrieved successfully")
      );
    } catch (error) {
      console.error("Error getting/creating primary profile:", error);
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

      console.log('getUserProfiles - oxyUserId:', oxyUserId);

      // Use field selection for better performance
      const selectFields = '_id oxyUserId profileType isPrimary isActive createdAt updatedAt';
      const profiles = await Profile.findByOxyUserId(oxyUserId, selectFields);
      
      console.log('getUserProfiles - profiles found:', profiles?.length || 0);
      console.log('getUserProfiles - profiles:', profiles);
      
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

      if (!["personal", "roommate", "agency"].includes(profileType)) {
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

      if (!["personal", "roommate", "agency"].includes(profileType)) {
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

      // Create profile based on type
      const profileData = {
        oxyUserId,
        profileType,
        isPrimary: false,
        isActive: true
      };

      switch (profileType) {
        case "personal":
          profileData.personalProfile = {
            preferences: data.preferences || {},
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
          
        case "roommate":
          profileData.roommateProfile = {
            roommatePreferences: data.roommatePreferences || {},
            roommateHistory: data.roommateHistory || [],
            references: data.references || []
          };
          break;
          
        case "agency":
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
      }

      const profile = new Profile(profileData);
      
      // Calculate initial trust score
      if (profileType === "personal") {
        profile.calculateTrustScore();
      }
      
      await profile.save();

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

      // Update profile data
      Object.keys(updateData).forEach(key => {
        if (key === "personalProfile" || key === "roommateProfile" || key === "agencyProfile") {
          profile[key] = { ...profile[key], ...updateData[key] };
        } else {
          profile[key] = updateData[key];
        }
      });

      // Recalculate trust score for personal profiles
      if (profile.profileType === "personal") {
        profile.calculateTrustScore();
      }

      await profile.save();

      // Clear cache after update
      this.clearCachedProfile(oxyUserId, 'primary');

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

      if (profile.isPrimary) {
        return res.status(400).json(
          errorResponse("Cannot delete primary profile", "CANNOT_DELETE_PRIMARY")
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

      if (profile.profileType !== "agency") {
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

      if (profile.profileType !== "agency") {
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
   * Update primary profile (no profile ID needed)
   */
  async updatePrimaryProfile(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const updateData = req.body;
      
      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Find the primary profile for this user (non-lean for updates)
      const profile = await Profile.findOne({ 
        oxyUserId, 
        isPrimary: true, 
        isActive: true 
      });
      
      if (!profile) {
        return res.status(404).json(
          errorResponse("Primary profile not found", "PROFILE_NOT_FOUND")
        );
      }

      // Update the profile
      if (updateData.personalProfile) {
        profile.personalProfile = {
          ...profile.personalProfile,
          ...updateData.personalProfile
        };
      }

      if (updateData.roommateProfile) {
        profile.roommateProfile = {
          ...profile.roommateProfile,
          ...updateData.roommateProfile
        };
      }

      if (updateData.agencyProfile) {
        profile.agencyProfile = {
          ...profile.agencyProfile,
          ...updateData.agencyProfile
        };
      }

      if (updateData.isPrimary !== undefined) {
        profile.isPrimary = updateData.isPrimary;
      }

      if (updateData.isActive !== undefined) {
        profile.isActive = updateData.isActive;
      }

      // Recalculate trust score for personal profiles
      if (profile.profileType === "personal") {
        profile.calculateTrustScore();
      }

      await profile.save();

      // Clear cache after update
      this.clearCachedProfile(oxyUserId, 'primary');

      res.json(
        successResponse(profile, "Primary profile updated successfully")
      );
    } catch (error) {
      console.error("Error updating primary profile:", error);
      next(error);
    }
  }

  /**
   * Update primary profile trust score (no profile ID needed)
   */
  async updatePrimaryTrustScore(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const { factor, value } = req.body;
      
      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Find the primary profile for this user (non-lean for updates)
      const profile = await Profile.findOne({ 
        oxyUserId, 
        isPrimary: true, 
        isActive: true 
      });
      
      if (!profile) {
        return res.status(404).json(
          errorResponse("Primary profile not found", "PROFILE_NOT_FOUND")
        );
      }

      if (profile.profileType !== "personal") {
        return res.status(400).json(
          errorResponse("Can only update trust score for personal profiles", "INVALID_PROFILE_TYPE")
        );
      }

      await profile.updateTrustScore(factor, value);

      res.json(
        successResponse(profile, "Trust score updated successfully")
      );
    } catch (error) {
      console.error("Error updating primary trust score:", error);
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

      if (profile.profileType !== "personal") {
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
      const profile = await Profile.findPrimaryByOxyUserId(
        oxyUserId, 
        'personalProfile.trustScore profileType'
      );
      
      if (!profile || profile.profileType !== 'personal') {
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
   * Recalculate trust score for primary profile
   */
  async recalculatePrimaryTrustScore(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      
      if (!oxyUserId) {
        return res.status(401).json(
          errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
        );
      }

      // Find the primary profile for this user
      const profile = await Profile.findPrimaryByOxyUserId(oxyUserId);
      
      if (!profile) {
        return res.status(404).json(
          errorResponse("Primary profile not found", "PROFILE_NOT_FOUND")
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
      console.error("Error recalculating primary trust score:", error);
      next(error);
    }
  }
}

module.exports = new ProfileController(); 