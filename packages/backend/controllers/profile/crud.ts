import {
  Profile,
  Saved,
  successResponse,
  errorResponse,
  _getOxyUserId,
  _createDefaultProfile,
  getCachedProfile,
  setCachedProfile,
  clearCachedProfile,
} from './shared';
import type { IProfile } from '../../models';

/**
 * Get or create the user's RE sidecar profile.
 */
export async function getOrCreateProfile(req: any, res: any, next: any) {
  try {
    const oxyUserId = _getOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'),
      );
    }

    let profile = getCachedProfile<IProfile>(oxyUserId);

    if (!profile) {
      profile = await Profile.findByOxyUserId(oxyUserId);

      if (!profile) {
        profile = await _createDefaultProfile(oxyUserId);
        clearCachedProfile(oxyUserId);
      } else if (req.query.minimal !== 'true') {
        profile = await Profile.findById(profile._id);
      }

      setCachedProfile(oxyUserId, profile);
    }

    res.json(successResponse(profile, 'Profile retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * Get the active public profile for an Oxy user id (read-only).
 */
export async function getPublicProfileByOxyUserId(req: any, res: any, next: any) {
  try {
    const { oxyUserId } = req.params;
    if (!oxyUserId) {
      return res.status(400).json(
        errorResponse('Oxy user id is required', 'OXY_USER_ID_REQUIRED'),
      );
    }

    const profile = await Profile.findByOxyUserId(oxyUserId);
    if (!profile) {
      return res.status(404).json(
        errorResponse('Profile not found', 'PROFILE_NOT_FOUND'),
      );
    }

    res.json(successResponse(profile, 'Profile retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * Get profile by Oxy user id (public read).
 */
export async function getProfileByOxyUserId(req: any, res: any, next: any) {
  return getPublicProfileByOxyUserId(req, res, next);
}

/**
 * Update the authenticated user's profile.
 */
export async function updateMyProfile(req: any, res: any, next: any) {
  try {
    const oxyUserId = _getOxyUserId(req);
    const updateData = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'),
      );
    }

    let profile = await Profile.findByOxyUserId(oxyUserId);

    if (!profile) {
      profile = await _createDefaultProfile(oxyUserId);
    }

    if (updateData.personalProfile) {
      profile.personalProfile = {
        ...profile.personalProfile,
        ...updateData.personalProfile,
      };
    }

    await profile.save();
    clearCachedProfile(oxyUserId);

    res.json(successResponse(profile, 'Profile updated successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * Test endpoint to check if the controller is working.
 */
export async function test(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;

    res.json({
      success: true,
      message: 'Profile controller is working',
      oxyUserId,
      hasUser: !!req.user,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}
