import type { Request, Response, NextFunction } from 'express';
import { Profile } from '../../models';
import {
  successResponse,
  errorResponse,
  _getOxyUserId,
  getCachedProfile,
  setCachedProfile,
  clearCachedProfile,
} from './shared';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { IProfile } from '../../models';

export async function getSidecarProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);

    let profile = getCachedProfile<IProfile>(oxyUserId, 'sidecar');

    if (!profile) {
      profile = await Profile.findOne({ oxyUserId });
      if (!profile) {
        return res.json(successResponse(null, 'No RE sidecar profile yet'));
      }

      if (req.query.minimal !== 'true') {
        const reloaded = await Profile.findById(profile._id);
        if (reloaded) {
          profile = reloaded;
        }
      }

      setCachedProfile(oxyUserId, profile, 'sidecar');
    }

    res.json(successResponse(profile, 'Profile retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

export async function updateSidecarProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const updateData = req.body;

    let profile = await Profile.findOne({ oxyUserId });
    if (!profile) {
      profile = await Profile.create({ oxyUserId, personalProfile: {} });
    }

    if (updateData.personalProfile && typeof updateData.personalProfile === 'object') {
      profile.personalProfile = {
        ...(profile.personalProfile as Record<string, unknown> | undefined),
        ...(updateData.personalProfile as Record<string, unknown>),
      };
    }

    if (updateData.reCredentials && typeof updateData.reCredentials === 'object') {
      profile.reCredentials = {
        ...(profile.reCredentials as Record<string, unknown> | undefined),
        ...(updateData.reCredentials as Record<string, unknown>),
      };
    }

    await profile.save();
    clearCachedProfile(oxyUserId, 'sidecar');

    res.json(successResponse(profile, 'Profile updated successfully'));
  } catch (error) {
    next(error);
  }
}
