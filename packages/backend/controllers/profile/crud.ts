import {
  Profile,
  successResponse,
  errorResponse,
  _getOxyUserId,
  getCachedProfile,
  setCachedProfile,
  clearCachedProfile,
} from './shared';
import type { IProfile } from '../../models';

/**
 * Get or create the Homiio sidecar profile for the active Oxy account.
 * One profile per oxyUserId — account switching is handled by Oxy SDK.
 */
export async function getOrCreateActiveProfile(req: { user?: { id?: string; _id?: string }; query?: { minimal?: string } }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }, next: (err?: unknown) => void) {
  try {
    const oxyUserId = _getOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json(errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'));
    }

    let profile = getCachedProfile<IProfile>(oxyUserId, 'profile');
    if (!profile) {
      if (!Profile.findOrCreateByOxyUserId) {
        throw new Error('Profile.findOrCreateByOxyUserId is not configured');
      }
      profile = await Profile.findOrCreateByOxyUserId(oxyUserId);
      setCachedProfile(oxyUserId, profile, 'profile');
    }

    res.json(successResponse(profile, 'Profile retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * @deprecated Multi-profile listing removed — one sidecar per Oxy account.
 * Returns a single-element array for backward compatibility during migration.
 */
export async function getUserProfiles(req: { user?: { id?: string; _id?: string } }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }, next: (err?: unknown) => void) {
  try {
    const oxyUserId = _getOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json(errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'));
    }
    const profile = await Profile.findOrCreateByOxyUserId(oxyUserId);
    res.json(successResponse(profile ? [profile] : [], 'Profiles retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * Update the caller's sidecar profile (by profile id, ownership-checked).
 */
export async function updateProfile(req: { user?: { id?: string; _id?: string }; params: { profileId: string }; body: Record<string, unknown> }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }, next: (err?: unknown) => void) {
  try {
    const oxyUserId = _getOxyUserId(req);
    const { profileId } = req.params;
    const updateData = req.body;

    if (!oxyUserId) {
      return res.status(401).json(errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'));
    }

    const profile = await Profile.findById(profileId);
    if (!profile) {
      return res.status(404).json(errorResponse('Profile not found', 'PROFILE_NOT_FOUND'));
    }
    if (profile.oxyUserId !== oxyUserId) {
      return res.status(403).json(errorResponse('Access denied', 'ACCESS_DENIED'));
    }

    for (const key of ['personalProfile', 'agencyProfile', 'businessProfile', 'cooperativeProfile'] as const) {
      if (updateData[key] && typeof updateData[key] === 'object') {
        profile[key] = { ...(profile[key] as object), ...(updateData[key] as object) };
      }
    }

    await profile.save();
    clearCachedProfile(oxyUserId, 'profile');

    res.json(successResponse(profile, 'Profile updated successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * Get profile by Mongo id (public read when mounted on public routes).
 */
export async function getProfileById(req: { params: { profileId: string } }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }, next: (err?: unknown) => void) {
  try {
    const { profileId } = req.params;
    if (!profileId) {
      return res.status(400).json(errorResponse('Profile ID is required', 'PROFILE_ID_REQUIRED'));
    }
    const profile = await Profile.findById(profileId);
    if (!profile) {
      return res.status(404).json(errorResponse('Profile not found', 'PROFILE_NOT_FOUND'));
    }
    res.json(successResponse(profile, 'Profile retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

export async function test(req: { user?: { id?: string; _id?: string } }, res: { json: (body: unknown) => void }, next: (err?: unknown) => void) {
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
