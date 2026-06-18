import {
  Profile,
  ProfileType,
  successResponse,
  errorResponse,
  getCachedProfile,
  setCachedProfile,
  clearCachedProfile,
} from './shared';

/**
 * Update active profile trust score (no profile ID needed)
 */
export async function updateActiveTrustScore(req: any, res: any, next: any) {
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
  clearCachedProfile(oxyUserId, 'trustScore');

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
export async function updateTrustScore(req: any, res: any, next: any) {
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
  clearCachedProfile(oxyUserId, 'trustScore');

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
export async function getTrustScore(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    // Check cache first
    const cached = getCachedProfile(oxyUserId, 'trustScore');
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
    setCachedProfile(oxyUserId, trustScore, 'trustScore');

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
export async function recalculateActiveTrustScore(req: any, res: any, next: any) {
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
