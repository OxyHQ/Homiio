/**
 * Roommate Controller
 * Handles roommate matching operations with Oxy user data integration
 */

import type { Request, Response } from 'express';
import type { PopulatedProfileLike } from './roommate/serialize';
import type { IProfile } from '../models/documentTypes';

import { Profile } from '../models';
import { getDb } from '../db/postgres';
import {
  createRoommateRequest,
  endRoommateRelationship as endRelationshipRow,
  ensureActiveRelationship,
  clampMatchScore,
  listRoommateRelationships,
  listRoommateRequests,
  PendingRoommateRequestExistsError,
  respondToRoommateRequest as respondToRequestRow,
  toRoommateRequestDTO,
  type RoommateRelationshipRow,
  type RoommateRequestRow,
} from '../db/roommates/roommateRepository';
import { logger } from '../middlewares/logging';
import { notificationDispatchService } from '../services/notificationDispatchService';
import { pickFields } from '../utils/pickFields';
import { EDITABLE_ROOMMATE_PREFERENCE_FIELDS } from './roommate/editableFields';
import { ROOMMATE_PROFILE_FIELDS, hydrateDisplayNames, serializeRoommateProfile } from './roommate/serialize';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

/** Resolve the Oxy user id from the request in the shape the auth layer sets. */
function resolveOxyUserId(req: Request): string | undefined {
  const authed = req as unknown as { user?: { id?: string; _id?: string }; userId?: string };
  return authed.user?.id || authed.user?._id || authed.userId;
}

/**
 * Domain shape of the roommate-matching slice stored under
 * `IProfile.personalProfile.settings.roommate`. The schema persists this as a
 * Mixed subdocument, so we re-declare the bits this controller actually
 * touches and narrow at the read boundary (see `getRoommatePrefs` below).
 */
interface RoommatePreferences {
  budget?: { min?: number; max?: number };
  lifestyle?: {
    pets?: string;
    smoking?: string;
    [key: string]: unknown;
  };
  ageRange?: { min?: number; max?: number };
  gender?: string;
  moveInDate?: string;
  leaseDuration?: string;
  interests?: string[];
  location?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

interface RoommateSlice {
  enabled?: boolean;
  preferences?: RoommatePreferences;
}

interface PersonalProfileShape {
  settings?: { roommate?: RoommateSlice } & Record<string, unknown>;
  [key: string]: unknown;
}

/** Read the `personalProfile` slice with the controller's domain shape. */
const personalOf = (profile: unknown): PersonalProfileShape | undefined => {
  if (!profile || typeof profile !== 'object') return undefined;
  const slice = (profile as { personalProfile?: unknown }).personalProfile;
  return (slice ?? undefined) as PersonalProfileShape | undefined;
};

/** Preferences for a (possibly populated) profile ref, for match scoring. */
const prefsOf = (profile: unknown): RoommatePreferences | undefined =>
  personalOf(profile)?.settings?.roommate?.preferences;

// Get all roommate profiles with enriched Oxy user data
const getRoommateProfiles = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { page = 1, limit = 20, minMatchPercentage, maxBudget, withPets, nonSmoking, ageRange, gender, location } = req.query;

    const oxyUserId = resolveOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Resolve the caller's active profile server-side so we can exclude it and
    // score candidates against its preferences.
    const currentProfile = await Profile.findByOxyUserId(oxyUserId);
    if (!currentProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Build base query for personal profiles with roommate matching enabled
    const query: Record<string, unknown> = {
      'personalProfile.settings.roommate.enabled': true,
      oxyUserId: { $ne: oxyUserId },
    };

    // Add basic filters that apply to profile data (not preferences)
    if (gender && gender !== 'any') {
      query['personalProfile.gender'] = gender;
    }

    if (location) {
      query['personalProfile.location'] = { $regex: location, $options: 'i' };
    }

    if (ageRange) {
      const { min, max } = JSON.parse(String(ageRange)) as { min: number; max: number };
      const currentYear = new Date().getFullYear();
      query['personalProfile.dateOfBirth'] = {
        $gte: new Date(currentYear - max, 0, 1),
        $lte: new Date(currentYear - min, 11, 31)
      };
    }

    const pageNum = parseInt(String(page), 10) || 1;
    const limitNum = parseInt(String(limit), 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const profiles = await Profile.find(query)
      .skip(skip)
      .limit(limitNum)
      .sort({ updatedAt: -1 });

    const total = await Profile.countDocuments(query);
    const totalPages = Math.ceil(total / limitNum);

    const currentUserPrefs = prefsOf(currentProfile);

    type EnrichedProfile = Record<string, unknown> & { matchPercentage: number };
    let profilesWithMatches: EnrichedProfile[] = profiles.map((profile: IProfile) => ({
      ...profile.toObject(),
      matchPercentage: 0,
    }));

    if (currentUserPrefs) {
      profilesWithMatches = profiles.map((profile: IProfile) => {
        const profilePrefs = prefsOf(profile);
        const matchPercentage = calculateMatchPercentage(currentUserPrefs, profilePrefs);

        return {
          ...profile.toObject(),
          matchPercentage,
        };
      });

      // Apply preference-based filters
      if (maxBudget) {
        const budget = parseInt(String(maxBudget), 10);
        profilesWithMatches = profilesWithMatches.filter((profile) => {
          const profilePrefs = personalOf(profile)?.settings?.roommate?.preferences;
          const profileMax = profilePrefs?.budget?.max;
          if (typeof profileMax !== 'number') return true;
          return profileMax >= budget;
        });
      }

      if (withPets === 'true') {
        profilesWithMatches = profilesWithMatches.filter((profile) => {
          const profilePrefs = personalOf(profile)?.settings?.roommate?.preferences;
          if (!profilePrefs?.lifestyle?.pets) return true;
          return profilePrefs.lifestyle.pets === 'yes';
        });
      }

      if (nonSmoking === 'true') {
        profilesWithMatches = profilesWithMatches.filter((profile) => {
          const profilePrefs = personalOf(profile)?.settings?.roommate?.preferences;
          if (!profilePrefs?.lifestyle?.smoking) return true;
          return profilePrefs.lifestyle.smoking === 'no';
        });
      }

      // Filter by minimum match percentage if specified
      if (minMatchPercentage) {
        const minPct = parseInt(String(minMatchPercentage), 10);
        profilesWithMatches = profilesWithMatches.filter(
          (profile) => profile.matchPercentage >= minPct,
        );
      }

      // Sort by match percentage
      profilesWithMatches.sort((a, b) => b.matchPercentage - a.matchPercentage);
    }

    // No Oxy enrichment, just return profiles
    res.json({
      profiles: profilesWithMatches,
      total,
      page: pageNum,
      totalPages
    });
  } catch (error) {
    logger.error('Failed to fetch roommate profiles', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate profiles' });
  }
};

// Get current user's roommate preferences
const getMyRoommatePreferences = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findByOxyUserId(oxyUserId);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const prefs = personalOf(profile)?.settings?.roommate?.preferences;
    if (!prefs) {
      return res.json({ data: null });
    }

    res.json({ data: prefs });
  } catch (error) {
    logger.error('Failed to fetch roommate preferences', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate preferences' });
  }
};

// Update roommate preferences
const updateRoommatePreferences = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findByOxyUserId(oxyUserId);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const picked = pickFields<RoommatePreferences>(
      req.body,
      EDITABLE_ROOMMATE_PREFERENCE_FIELDS,
    );

    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(picked)) {
      updateData[`personalProfile.settings.roommate.preferences.${key}`] = value;
    }
    if (typeof req.body?.enabled === 'boolean') {
      updateData['personalProfile.settings.roommate.enabled'] = req.body.enabled;
    }

    const updatedProfile = await Profile.findByIdAndUpdate(
      profile._id,
      updateData,
      { new: true }
    );

    const updatedRoommate = personalOf(updatedProfile)?.settings?.roommate;
    res.json({
      data: updatedRoommate?.preferences ?? null,
      enabled: updatedRoommate?.enabled ?? false,
    });
  } catch (error) {
    logger.error('Failed to update roommate preferences', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to update roommate preferences' });
  }
};

// Toggle roommate matching
const toggleRoommateMatching = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { enabled } = req.body;
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findByOxyUserId(oxyUserId);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const updateData = {
      'personalProfile.settings.roommate.enabled': enabled,
    };

    const updatedProfile = await Profile.findByIdAndUpdate(profile._id, updateData, { new: true });

    const updatedEnabled = Boolean(
      personalOf(updatedProfile)?.settings?.roommate?.enabled,
    );

    res.json({
      message: `Roommate matching ${updatedEnabled ? 'enabled' : 'disabled'} successfully`,
      enabled: updatedEnabled,
    });
  } catch (error) {
    logger.error('Failed to toggle roommate matching', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to toggle roommate matching' });
  }
};

/** Serialize a single request row with hydrated display names + score. */
const serializeRequest = (
  request: RoommateRequestRow,
  profileByOxyUserId: Map<string, PopulatedProfileLike>,
  displayNames: Map<string, string>,
) => {
  const sender = serializeRoommateProfile(profileByOxyUserId.get(request.fromOxyUserId), displayNames);
  const receiver = serializeRoommateProfile(profileByOxyUserId.get(request.toOxyUserId), displayNames);
  const matchScore = calculateMatchPercentage(
    prefsOf(profileByOxyUserId.get(request.fromOxyUserId)),
    prefsOf(profileByOxyUserId.get(request.toOxyUserId)),
  );
  return {
    id: request.id,
    senderOxyUserId: request.fromOxyUserId,
    receiverOxyUserId: request.toOxyUserId,
    sender,
    receiver,
    status: request.status,
    message: request.message,
    matchScore,
    createdAt: request.createdAt,
  };
};

// Get roommate requests
const getRoommateRequests = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await Profile.findByOxyUserId(oxyUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { sent, received } = await listRoommateRequests(getDb(), oxyUserId);

    const participantOxyUserIds = Array.from(
      new Set(
        [...sent, ...received].flatMap((request) => [request.fromOxyUserId, request.toOxyUserId]),
      ),
    );
    const profiles = await Profile.find({ oxyUserId: { $in: participantOxyUserIds } })
      .select(ROOMMATE_PROFILE_FIELDS)
      .lean();
    const profileByOxyUserId = new Map<string, PopulatedProfileLike>(
      profiles.map((entry: PopulatedProfileLike & { oxyUserId: string }) => [String(entry.oxyUserId), entry as PopulatedProfileLike]),
    );
    const displayNames = await hydrateDisplayNames(participantOxyUserIds);

    res.json({
      data: {
        sent: sent.map((request) => serializeRequest(request, profileByOxyUserId, displayNames)),
        received: received.map((request) => serializeRequest(request, profileByOxyUserId, displayNames)),
      },
    });
  } catch (error) {
    logger.error('Failed to fetch roommate requests', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate requests' });
  }
};

// Send roommate request
const sendRoommateRequest = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { oxyUserId: targetOxyUserId } = req.params;
    const { message } = req.body;
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentProfile = await Profile.findByOxyUserId(oxyUserId);
    if (!currentProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (!targetOxyUserId) {
      return res.status(400).json({ error: 'Target oxy user id is required' });
    }

    if (oxyUserId === targetOxyUserId) {
      return res.status(400).json({ error: 'You cannot send a roommate request to yourself' });
    }

    const targetProfile = await Profile.findByOxyUserId(targetOxyUserId);
    if (!targetProfile) {
      return res.status(404).json({ error: 'Target user profile not found' });
    }

    if (!personalOf(targetProfile)?.settings?.roommate?.enabled) {
      return res.status(400).json({ error: 'Target user does not have roommate matching enabled' });
    }

    // The "already pending?" read is GONE in the forward direction: it was a
    // read-then-write with a window, and `roommate_requests_pending_pair_key`
    // is a real partial unique index. The repository raises the same 409 from
    // the index's own `23505`, and still reads for the REVERSE direction, which
    // no single-column index can express.
    let request;
    try {
      request = await createRoommateRequest(getDb(), {
        fromOxyUserId: oxyUserId,
        toOxyUserId: targetOxyUserId,
        message: typeof message === 'string' ? message : undefined,
      });
    } catch (error) {
      if (error instanceof PendingRoommateRequestExistsError) {
        return res.status(409).json({ error: 'A pending roommate request already exists between these users' });
      }
      throw error;
    }

    await notificationDispatchService.createForUser(targetOxyUserId, {
      type: 'roommate',
      title: 'New roommate request',
      message: 'Someone sent you a roommate request.',
      priority: 'high',
      data: { requestId: request.id, screen: '/roommates' },
    });

    res.status(201).json({
      message: 'Roommate request sent successfully',
      data: toRoommateRequestDTO(request),
    });
  } catch (error) {
    logger.error('Failed to send roommate request', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to send roommate request' });
  }
};

/**
 * Create (idempotently) the roommate relationship for an accepted request.
 *
 * The pair is sorted by the repository and the sort is enforced by
 * `roommate_relationships_sorted_pair_check`, so a writer that skipped it fails
 * loudly instead of producing a second, invisible row for the same two people.
 */
const createRelationshipForAcceptedRequest = async (request: RoommateRequestRow) => {
  const [fromProfile, toProfile] = await Promise.all([
    Profile.findOne({ oxyUserId: request.fromOxyUserId }).select('personalProfile'),
    Profile.findOne({ oxyUserId: request.toOxyUserId }).select('personalProfile'),
  ]);
  const matchScore = calculateMatchPercentage(prefsOf(fromProfile), prefsOf(toProfile));

  return ensureActiveRelationship(getDb(), {
    requestId: request.id,
    fromOxyUserId: request.fromOxyUserId,
    toOxyUserId: request.toOxyUserId,
    matchScore: clampMatchScore(matchScore),
  });
};

// Respond to a roommate request (accept/decline) - only the recipient may respond
const respondToRoommateRequest = async (req: Request, res: Response, status: 'accepted' | 'declined'): Promise<Response | void> => {
  const action = status === 'accepted' ? 'accept' : 'decline';
  try {
    const { requestId } = req.params;
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // The `ObjectId.isValid` guard is DELETED rather than widened (`db/ids.ts`):
    // post-cutover every request id is a uuid v7, which that guard rejects. The
    // `UPDATE` below already answers "no such pending request of yours" for a
    // malformed id, an unknown one and somebody else's alike.
    const request = await respondToRequestRow(getDb(), requestId, oxyUserId, status);

    if (!request) {
      return res.status(404).json({ error: 'Roommate request not found' });
    }

    // On accept, materialize the confirmed relationship (idempotent insert).
    if (status === 'accepted') {
      await createRelationshipForAcceptedRequest(request);
    }

    // Notify the original sender of the accept/decline decision.
    await notificationDispatchService.createForUser(request.fromOxyUserId, {
      type: 'roommate',
      title: status === 'accepted' ? 'Roommate request accepted' : 'Roommate request declined',
      message:
        status === 'accepted'
          ? 'Your roommate request was accepted.'
          : 'Your roommate request was declined.',
      priority: 'medium',
      data: { requestId: request.id, screen: '/roommates' },
    });

    res.json({
      message: `Roommate request ${status} successfully`,
      data: toRoommateRequestDTO(request),
    });
  } catch (error) {
    logger.error(`Failed to ${action} roommate request`, { error: errorMessage(error) });
    res.status(500).json({ error: `Failed to ${action} roommate request` });
  }
};

// Accept roommate request
const acceptRoommateRequest = async (req: Request, res: Response): Promise<Response | void> => {
  return respondToRoommateRequest(req, res, 'accepted');
};

// Decline roommate request
const declineRoommateRequest = async (req: Request, res: Response): Promise<Response | void> => {
  return respondToRoommateRequest(req, res, 'declined');
};

/** Serialize a relationship row with hydrated display names. */
const serializeRelationship = (
  relationship: RoommateRelationshipRow,
  profileByOxyUserId: Map<string, PopulatedProfileLike>,
  displayNames: Map<string, string>,
) => {
  const profile1 = serializeRoommateProfile(profileByOxyUserId.get(relationship.oxyUser1Id), displayNames);
  const profile2 = serializeRoommateProfile(profileByOxyUserId.get(relationship.oxyUser2Id), displayNames);
  return {
    id: relationship.id,
    oxyUser1Id: relationship.oxyUser1Id,
    oxyUser2Id: relationship.oxyUser2Id,
    profile1,
    profile2,
    status: relationship.status,
    matchScore: relationship.matchScore,
    startDate: relationship.startDate,
    endDate: relationship.endDate,
  };
};

// Get roommate relationships for the current profile
const getRoommateRelationships = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await Profile.findByOxyUserId(oxyUserId);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const relationships = await listRoommateRelationships(getDb(), oxyUserId);

    const participantOxyUserIds = Array.from(
      new Set(
        relationships.flatMap((relationship) => [relationship.oxyUser1Id, relationship.oxyUser2Id]),
      ),
    );
    const profiles = await Profile.find({ oxyUserId: { $in: participantOxyUserIds } })
      .select(ROOMMATE_PROFILE_FIELDS)
      .lean();
    const profileByOxyUserId = new Map<string, PopulatedProfileLike>(
      profiles.map((entry: PopulatedProfileLike & { oxyUserId: string }) => [String(entry.oxyUserId), entry as PopulatedProfileLike]),
    );
    const displayNames = await hydrateDisplayNames(participantOxyUserIds);

    res.json({
      data: relationships.map((relationship) =>
        serializeRelationship(relationship, profileByOxyUserId, displayNames),
      ),
    });
  } catch (error) {
    logger.error('Failed to fetch roommate relationships', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate relationships' });
  }
};

// End a roommate relationship - only a participant may end it
const endRoommateRelationship = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { relationshipId } = req.params;
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await Profile.findByOxyUserId(oxyUserId);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // The caller must be one of the two participants; a non-participant sees the
    // same 404 as a missing relationship (no existence leak). Both facts are in
    // the `UPDATE`'s predicate, so there is no window between the check and the
    // write — and the `ObjectId.isValid` guard is deleted rather than widened,
    // for the reason `db/ids.ts` gives.
    const relationship = await endRelationshipRow(getDb(), relationshipId, oxyUserId);

    if (!relationship) {
      return res.status(404).json({ error: 'Roommate relationship not found' });
    }

    const otherOxyUserId =
      relationship.oxyUser1Id === oxyUserId ? relationship.oxyUser2Id : relationship.oxyUser1Id;

    await notificationDispatchService.createForUser(otherOxyUserId, {
      type: 'roommate',
      title: 'Roommate relationship ended',
      message: 'A roommate relationship was ended.',
      priority: 'medium',
      data: { relationshipId: relationship.id, screen: '/roommates' },
    });

    res.json({
      message: 'Roommate relationship ended successfully',
      data: { id: relationship.id, status: relationship.status },
    });
  } catch (error) {
    logger.error('Failed to end roommate relationship', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to end roommate relationship' });
  }
};

// Helper function to calculate match percentage
const calculateMatchPercentage = (
  prefs1: RoommatePreferences | undefined,
  prefs2: RoommatePreferences | undefined
): number => {
  if (!prefs1 || !prefs2) return 0;

  let matchScore = 0;
  let totalFactors = 0;

  // Budget compatibility
  if (prefs1.budget && prefs2.budget) {
    const max1 = prefs1.budget.max ?? 0;
    const max2 = prefs2.budget.max ?? 0;
    const min1 = prefs1.budget.min ?? 0;
    const min2 = prefs2.budget.min ?? 0;
    const overlap = Math.min(max1, max2) - Math.max(min1, min2);
    if (overlap > 0) {
      matchScore += 20;
    }
    totalFactors += 20;
  }

  // Lifestyle compatibility
  if (prefs1.lifestyle && prefs2.lifestyle) {
    if (prefs1.lifestyle.smoking === prefs2.lifestyle.smoking) matchScore += 15;
    if (prefs1.lifestyle.pets === prefs2.lifestyle.pets) matchScore += 15;
    if (prefs1.lifestyle.cleanliness === prefs2.lifestyle.cleanliness) matchScore += 15;
    if (prefs1.lifestyle.schedule === prefs2.lifestyle.schedule) matchScore += 15;
    totalFactors += 60;
  }

  // Interests compatibility
  if (prefs1.interests && prefs2.interests) {
    const interests2 = prefs2.interests;
    const commonInterests = prefs1.interests.filter((interest: string) =>
      interests2.includes(interest)
    );
    const interestScore = (commonInterests.length / Math.max(prefs1.interests.length, prefs2.interests.length)) * 20;
    matchScore += interestScore;
    totalFactors += 20;
  }

  return totalFactors > 0 ? Math.round((matchScore / totalFactors) * 100) : 0;
};

// Get current user's roommate status with Oxy user data
const getCurrentUserRoommateStatus = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findByOxyUserId(oxyUserId);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const roommateSlice = personalOf(profile)?.settings?.roommate;
    const hasRoommateMatching = Boolean(roommateSlice?.enabled);

    res.json({
      hasRoommateMatching,
      profile: {
        id: profile._id,
        oxyUserId: profile.oxyUserId,
        roommatePreferences: roommateSlice?.preferences || null,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch roommate status', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate status' });
  }
};

export default {
  getRoommateProfiles,
  getMyRoommatePreferences,
  updateRoommatePreferences,
  toggleRoommateMatching,
  getRoommateRequests,
  sendRoommateRequest,
  acceptRoommateRequest,
  declineRoommateRequest,
  getRoommateRelationships,
  endRoommateRelationship,
  getCurrentUserRoommateStatus
};
