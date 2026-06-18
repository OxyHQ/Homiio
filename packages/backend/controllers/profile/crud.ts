import {
  Profile,
  ProfileType,
  successResponse,
  errorResponse,
  _getOxyUserId,
  _createDefaultPersonalProfile,
  getCachedProfile,
  setCachedProfile,
  clearCachedProfile,
} from './shared';
import type { IProfile } from '../../models';

async function activateProfileForUser(oxyUserId: string, profileId: unknown): Promise<void> {
  if (!Profile.activateProfile) {
    throw new Error('Profile activation is not configured');
  }

  await Profile.activateProfile(oxyUserId, profileId);
}

/**
 * Test endpoint to check if the controller is working
 */
export async function test(req: any, res: any, next: any) {
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
export async function getOrCreateActiveProfile(req: any, res: any, next: any) {
  try {
    const oxyUserId = _getOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

  // Check cache first
    let profile = getCachedProfile<IProfile>(oxyUserId, 'active');

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
          clearCachedProfile(oxyUserId, 'active');

          profile = personalProfile;
        } else {
  const defaultPersonalProfile = await _createDefaultPersonalProfile(oxyUserId);
  // Clear cache after creating new profile
  clearCachedProfile(oxyUserId, 'active');
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
      setCachedProfile(oxyUserId, profile, 'active');
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
export async function getUserProfiles(req: any, res: any, next: any) {
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
export async function getProfileByType(req: any, res: any, next: any) {
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
export async function createProfile(req: any, res: any, next: any) {
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
      const profile = await _createDefaultPersonalProfile(oxyUserId);
      if (data && typeof data === 'object') {
        // Merge any provided partials. Cast inner nested slices through Record<string, unknown>
        // because Mongoose stores personalProfile as a Mixed subdocument.
        const existing = (profile.personalProfile ?? {}) as Record<string, unknown>;
        const existingInfo = (existing.personalInfo ?? {}) as Record<string, unknown>;
        const existingSettings = (existing.settings ?? {}) as Record<string, unknown>;
        const nextInfo = (data.personalInfo ?? {}) as Record<string, unknown>;
        const nextSettings = (data.settings ?? {}) as Record<string, unknown>;
        profile.personalProfile = {
          ...existing,
          ...data,
          personalInfo: { ...existingInfo, ...nextInfo },
          settings: { ...existingSettings, ...nextSettings },
        };
        profile.calculateTrustScore?.();
        await profile.save();
      }
      // Clear cache after creating new profile
      clearCachedProfile(oxyUserId, 'active');
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
    clearCachedProfile(oxyUserId, 'active');

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
export async function updateProfile(req: any, res: any, next: any) {
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
      await activateProfileForUser(oxyUserId, profile._id);
      // Clear the cached active profile since we just changed which profile is active
      clearCachedProfile(oxyUserId, 'active');
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
    clearCachedProfile(oxyUserId, 'active');

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
export async function deleteProfile(req: any, res: any, next: any) {
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
    clearCachedProfile(oxyUserId, 'active');
    clearCachedProfile(oxyUserId, profileId);

    res.json(
      successResponse({ profileId }, "Profile deleted successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Activate a specific profile
 */
export async function activateProfile(req: any, res: any, next: any) {
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

    await activateProfileForUser(oxyUserId, profile._id);

    // Clear the cached active profile since we just changed which profile is active
    clearCachedProfile(oxyUserId, 'active');

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
export async function getProfileById(req: any, res: any, next: any) {
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
 * Update active profile (no profile ID needed)
 */
export async function updateActiveProfile(req: any, res: any, next: any) {
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
      await activateProfileForUser(oxyUserId, profile._id);
      // Clear the cached active profile since we just changed which profile is active
      clearCachedProfile(oxyUserId, 'active');
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
    clearCachedProfile(oxyUserId, 'active');

    res.json(
      successResponse(profile, "Active profile updated successfully")
    );
  } catch (error) {
    next(error);
  }
}
