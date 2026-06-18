import {
  Profile,
  ProfileType,
  successResponse,
  errorResponse,
} from './shared';
import { getErrorMessage } from '../../utils/errors';

/**
 * Get agency memberships for a user
 */
export async function getAgencyMemberships(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!Profile.findAgencyMemberships) {
      throw new Error('Agency membership lookup is not configured');
    }

    const memberships = await Profile.findAgencyMemberships(oxyUserId);

    res.json(
      successResponse(memberships, "Agency memberships retrieved successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Add member to agency profile
 */
export async function addAgencyMember(req: any, res: any, next: any) {
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

    const agencyProfile = profile.agencyProfile;
    if (!agencyProfile) {
      return res.status(400).json(
        errorResponse("Agency profile details are missing", "AGENCY_PROFILE_MISSING")
      );
    }

    const userMember = agencyProfile.members.find(m => m.oxyUserId === oxyUserId);
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
    const message = getErrorMessage(error);
    if (message === "Member already exists in this agency") {
      return res.status(409).json(
        errorResponse(message, "MEMBER_ALREADY_EXISTS")
      );
    }
    next(error);
  }
}

/**
 * Remove member from agency profile
 */
export async function removeAgencyMember(req: any, res: any, next: any) {
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

    const agencyProfile = profile.agencyProfile;
    if (!agencyProfile) {
      return res.status(400).json(
        errorResponse("Agency profile details are missing", "AGENCY_PROFILE_MISSING")
      );
    }

    const userMember = agencyProfile.members.find(m => m.oxyUserId === oxyUserId);
    if (!userMember || !["owner", "admin"].includes(userMember.role)) {
      return res.status(403).json(
        errorResponse("Insufficient permissions", "INSUFFICIENT_PERMISSIONS")
      );
    }

    const targetMember = agencyProfile.members.find(m => m.oxyUserId === memberOxyUserId);
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
    next(error);
  }
}
