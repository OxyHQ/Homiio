const { Profile } = require("../models");
const { successResponse, errorResponse } = require("../utils/helpers");

class ProfileController {
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

      // Try to find existing primary profile
      let profile = await Profile.findPrimaryByOxyUserId(oxyUserId);
      
      if (!profile) {
        // Create a new personal profile as primary
        profile = new Profile({
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
        
        await profile.save();
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

      const profiles = await Profile.findByOxyUserId(oxyUserId);
      
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

      // Ensure user owns this profile or is a member of the agency
      if (profile.oxyUserId !== oxyUserId) {
        if (profile.profileType === "agency") {
          const isMember = profile.agencyProfile.members.some(m => m.oxyUserId === oxyUserId);
          if (!isMember) {
            return res.status(403).json(
              errorResponse("Access denied", "ACCESS_DENIED")
            );
          }
        } else {
          return res.status(403).json(
            errorResponse("Access denied", "ACCESS_DENIED")
          );
        }
      }

      // Update profile data
      if (updateData.personalProfile) {
        profile.personalProfile = { ...profile.personalProfile, ...updateData.personalProfile };
      }
      if (updateData.roommateProfile) {
        profile.roommateProfile = { ...profile.roommateProfile, ...updateData.roommateProfile };
      }
      if (updateData.agencyProfile) {
        profile.agencyProfile = { ...profile.agencyProfile, ...updateData.agencyProfile };
      }
      if (updateData.isPrimary !== undefined) {
        profile.isPrimary = updateData.isPrimary;
      }
      if (updateData.isActive !== undefined) {
        profile.isActive = updateData.isActive;
      }

      await profile.save();

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

      // Find the primary profile for this user
      const profile = await Profile.findPrimaryByOxyUserId(oxyUserId);
      
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

      await profile.save();

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

      // Find the primary profile for this user
      const profile = await Profile.findPrimaryByOxyUserId(oxyUserId);
      
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
}

module.exports = new ProfileController(); 