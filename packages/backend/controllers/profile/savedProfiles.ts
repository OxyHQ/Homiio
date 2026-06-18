import {
  Profile,
  Saved,
  successResponse,
  errorResponse,
} from './shared';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

/**
 * Save (follow) a profile for the current user's active profile
 */
export async function saveProfile(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
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
export async function unsaveProfile(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
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
export async function isProfileSaved(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
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
 * Get saved (followed) profiles for the current user's profile
 */
export async function getSavedProfiles(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
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
