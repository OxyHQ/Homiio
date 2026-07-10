import {
  Profile,
  Saved,
  successResponse,
  errorResponse,
} from './shared';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

export async function saveProfile(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { oxyUserId: targetOxyUserId } = req.body as { oxyUserId?: string };
    if (!oxyUserId) {
      return res.status(401).json(errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'));
    }
    if (!targetOxyUserId) {
      return res.status(400).json(errorResponse('Oxy user id is required', 'OXY_USER_ID_REQUIRED'));
    }
    if (targetOxyUserId === oxyUserId) {
      return res.status(400).json(errorResponse('Cannot follow yourself', 'SELF_FOLLOW'));
    }
    await Saved.updateOne(
      { oxyUserId, targetType: 'user', targetId: targetOxyUserId },
      { $set: { oxyUserId, targetType: 'user', targetId: targetOxyUserId, createdAt: new Date() } },
      { upsert: true },
    );
    return res.json(successResponse({}, 'Profile saved'));
  } catch (error) {
    next(error);
  }
}

export async function unsaveProfile(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { oxyUserId: targetOxyUserId } = req.params;
    if (!oxyUserId) {
      return res.status(401).json(errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'));
    }
    if (!targetOxyUserId) {
      return res.status(400).json(errorResponse('Oxy user id is required', 'OXY_USER_ID_REQUIRED'));
    }
    await Saved.deleteOne({ oxyUserId, targetType: 'user', targetId: targetOxyUserId });
    return res.json(successResponse({}, 'Profile unsaved'));
  } catch (error) {
    next(error);
  }
}

export async function isProfileSaved(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { oxyUserId: targetOxyUserId } = req.params;
    if (!oxyUserId) {
      return res.status(401).json(errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'));
    }
    if (!targetOxyUserId) {
      return res.status(400).json(errorResponse('Oxy user id is required', 'OXY_USER_ID_REQUIRED'));
    }
    const exists = await Saved.findOne({ oxyUserId, targetType: 'user', targetId: targetOxyUserId }).lean();
    return res.json(successResponse({ saved: !!exists }, 'Saved status'));
  } catch (error) {
    next(error);
  }
}

export async function getSavedProfiles(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    if (!oxyUserId) {
      return res.status(401).json(errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'));
    }
    const follows = await Saved.find({ oxyUserId, targetType: 'user' }).lean();
    const ids = follows.map((f) => String(f.targetId));
    const profiles = await Profile.find({ oxyUserId: { $in: ids } }).lean();
    return res.json(successResponse(profiles, 'Saved profiles retrieved'));
  } catch (error) {
    next(error);
  }
}
