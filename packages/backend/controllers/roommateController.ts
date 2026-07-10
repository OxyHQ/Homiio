/**
 * Roommate Controller
 * Handles roommate matching operations with Oxy user data integration
 */

import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import type { PopulatedProfileLike } from './roommate/serialize';
import type { IProfile } from '../models/documentTypes';

const { Profile, RoommateRequest, RoommateRelationship } = require('../models');
const { logger } = require('../middlewares/logging');
const { notificationDispatchService } = require('../services/notificationDispatchService');
const { pickFields } = require('../utils/pickFields') as typeof import('../utils/pickFields');
const { EDITABLE_ROOMMATE_PREFERENCE_FIELDS } = require('./roommate/editableFields');
const {
  ROOMMATE_PROFILE_FIELDS,
  hydrateDisplayNames,
  serializeRoommateProfile,
} = require('./roommate/serialize');

const { Types: MongooseTypes } = require('mongoose') as typeof import('mongoose');

interface RoommateRequestLean {
  _id: unknown;
  fromOxyUserId: unknown;
  toOxyUserId: unknown;
  status: unknown;
  message?: unknown;
  createdAt: unknown;
}

interface RoommateRelationshipLean {
  _id: unknown;
  oxyUser1Id: unknown;
  oxyUser2Id: unknown;
  status: unknown;
  matchScore?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}

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

/** Serialize a single request document with hydrated display names + score. */
const serializeRequest = (
  request: {
    _id: unknown;
    fromOxyUserId: string;
    toOxyUserId: string;
    status: string;
    message?: string;
    createdAt: Date;
  },
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
    id: String(request._id),
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

    const [sent, received] = await Promise.all([
      RoommateRequest.find({ fromOxyUserId: oxyUserId }).sort({ createdAt: -1 }).lean(),
      RoommateRequest.find({ toOxyUserId: oxyUserId }).sort({ createdAt: -1 }).lean(),
    ]);

    const participantOxyUserIds = Array.from(
      new Set(
        [...sent, ...received].flatMap((request) => [
          String(request.fromOxyUserId),
          String(request.toOxyUserId),
        ]),
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
        sent: sent.map((r: RoommateRequestLean) => serializeRequest({
          _id: r._id,
          fromOxyUserId: String(r.fromOxyUserId),
          toOxyUserId: String(r.toOxyUserId),
          status: String(r.status),
          message: typeof r.message === 'string' ? r.message : undefined,
          createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt)),
        }, profileByOxyUserId, displayNames)),
        received: received.map((r: RoommateRequestLean) => serializeRequest({
          _id: r._id,
          fromOxyUserId: String(r.fromOxyUserId),
          toOxyUserId: String(r.toOxyUserId),
          status: String(r.status),
          message: typeof r.message === 'string' ? r.message : undefined,
          createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt)),
        }, profileByOxyUserId, displayNames)),
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

    const existingRequest = await RoommateRequest.findOne({
      status: 'pending',
      $or: [
        { fromOxyUserId: oxyUserId, toOxyUserId: targetOxyUserId },
        { fromOxyUserId: targetOxyUserId, toOxyUserId: oxyUserId },
      ],
    });

    if (existingRequest) {
      return res.status(409).json({ error: 'A pending roommate request already exists between these users' });
    }

    const request = await RoommateRequest.create({
      fromOxyUserId: oxyUserId,
      toOxyUserId: targetOxyUserId,
      message: typeof message === 'string' ? message : undefined,
    });

    await notificationDispatchService.createForUser(targetOxyUserId, {
      type: 'roommate',
      title: 'New roommate request',
      message: 'Someone sent you a roommate request.',
      priority: 'high',
      data: { requestId: request._id.toString(), screen: '/roommates' },
    });

    res.status(201).json({
      message: 'Roommate request sent successfully',
      data: request,
    });
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: number }).code === 11000) {
      return res.status(409).json({ error: 'A pending roommate request already exists between these users' });
    }
    logger.error('Failed to send roommate request', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to send roommate request' });
  }
};

/**
 * Deterministically sort two profile ids so a pair maps to one canonical
 * relationship row (`oxyUser1Id` < `oxyUser2Id` by string).
 */
const sortPair = (a: string, b: string): [string, string] =>
  a < b ? [a, b] : [b, a];

/**
 * Create (idempotently) the roommate relationship for an accepted request.
 * Returns the relationship document.
 */
const createRelationshipForAcceptedRequest = async (request: {
  _id: Types.ObjectId;
  fromOxyUserId: string;
  toOxyUserId: string;
}) => {
  const [fromProfile, toProfile] = await Promise.all([
    Profile.findOne({ oxyUserId: request.fromOxyUserId }).select('personalProfile'),
    Profile.findOne({ oxyUserId: request.toOxyUserId }).select('personalProfile'),
  ]);
  const matchScore = calculateMatchPercentage(prefsOf(fromProfile), prefsOf(toProfile));
  const [oxyUser1Id, oxyUser2Id] = sortPair(request.fromOxyUserId, request.toOxyUserId);

  return RoommateRelationship.findOneAndUpdate(
    { oxyUser1Id, oxyUser2Id, status: 'active' },
    {
      $setOnInsert: {
        oxyUser1Id,
        oxyUser2Id,
        requestId: request._id,
        matchScore,
        status: 'active',
        startDate: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
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

    if (!MongooseTypes.ObjectId.isValid(requestId)) {
      return res.status(404).json({ error: 'Roommate request not found' });
    }

    const request = await RoommateRequest.findOne({
      _id: requestId,
      toOxyUserId: oxyUserId,
      status: 'pending'
    });

    if (!request) {
      return res.status(404).json({ error: 'Roommate request not found' });
    }

    request.status = status;
    await request.save();

    // On accept, materialize the confirmed relationship (idempotent upsert).
    if (status === 'accepted') {
      await createRelationshipForAcceptedRequest({
        _id: request._id as Types.ObjectId,
        fromOxyUserId: String(request.fromOxyUserId),
        toOxyUserId: String(request.toOxyUserId),
      });
    }

    // Notify the original sender of the accept/decline decision.
    await notificationDispatchService.createForUser(request.fromOxyUserId.toString(), {
      type: 'roommate',
      title: status === 'accepted' ? 'Roommate request accepted' : 'Roommate request declined',
      message:
        status === 'accepted'
          ? 'Your roommate request was accepted.'
          : 'Your roommate request was declined.',
      priority: 'medium',
      data: { requestId: request._id.toString(), screen: '/roommates' },
    });

    res.json({
      message: `Roommate request ${status} successfully`,
      data: request
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

/** Serialize a relationship document with hydrated display names. */
const serializeRelationship = (
  relationship: {
    _id: unknown;
    oxyUser1Id: string;
    oxyUser2Id: string;
    status: string;
    matchScore?: number;
    startDate?: Date;
    endDate?: Date;
  },
  profileByOxyUserId: Map<string, PopulatedProfileLike>,
  displayNames: Map<string, string>,
) => {
  const profile1 = serializeRoommateProfile(profileByOxyUserId.get(relationship.oxyUser1Id), displayNames);
  const profile2 = serializeRoommateProfile(profileByOxyUserId.get(relationship.oxyUser2Id), displayNames);
  return {
    id: String(relationship._id),
    oxyUser1Id: relationship.oxyUser1Id,
    oxyUser2Id: relationship.oxyUser2Id,
    profile1,
    profile2,
    status: relationship.status,
    matchScore: relationship.matchScore ?? 0,
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

    const relationships = await RoommateRelationship.find({
      $or: [{ oxyUser1Id: oxyUserId }, { oxyUser2Id: oxyUserId }],
    })
      .sort({ createdAt: -1 })
      .lean();

    const participantOxyUserIds = Array.from(
      new Set(
        relationships.flatMap((relationship: Record<string, unknown>) => [
          String(relationship.oxyUser1Id),
          String(relationship.oxyUser2Id),
        ]),
      ),
    );
    const profiles = await Profile.find({ oxyUserId: { $in: participantOxyUserIds } })
      .select(ROOMMATE_PROFILE_FIELDS)
      .lean();
    const profileByOxyUserId = new Map<string, PopulatedProfileLike>(
      profiles.map((profile: PopulatedProfileLike & { oxyUserId: string }) => [String(profile.oxyUserId), profile as PopulatedProfileLike]),
    );
    const displayNames = await hydrateDisplayNames(participantOxyUserIds);

    res.json({
      data: relationships.map((r: RoommateRelationshipLean) =>
        serializeRelationship(
          {
            _id: r._id,
            oxyUser1Id: String(r.oxyUser1Id),
            oxyUser2Id: String(r.oxyUser2Id),
            status: String(r.status),
            matchScore: typeof r.matchScore === 'number' ? r.matchScore : undefined,
            startDate: r.startDate instanceof Date ? r.startDate : undefined,
            endDate: r.endDate instanceof Date ? r.endDate : undefined,
          },
          profileByOxyUserId,
          displayNames,
        ),
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

    if (!MongooseTypes.ObjectId.isValid(relationshipId)) {
      return res.status(404).json({ error: 'Roommate relationship not found' });
    }

    const profile = await Profile.findByOxyUserId(oxyUserId);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // The caller must be one of the two participants; a non-participant sees the
    // same 404 as a missing relationship (no existence leak).
    const relationship = await RoommateRelationship.findOne({
      _id: relationshipId,
      status: 'active',
      $or: [{ oxyUser1Id: oxyUserId }, { oxyUser2Id: oxyUserId }],
    });

    if (!relationship) {
      return res.status(404).json({ error: 'Roommate relationship not found' });
    }

    relationship.status = 'ended';
    relationship.endDate = new Date();
    await relationship.save();

    const otherOxyUserId =
      String(relationship.oxyUser1Id) === oxyUserId
        ? String(relationship.oxyUser2Id)
        : String(relationship.oxyUser1Id);

    await notificationDispatchService.createForUser(String(otherOxyUserId), {
      type: 'roommate',
      title: 'Roommate relationship ended',
      message: 'A roommate relationship was ended.',
      priority: 'medium',
      data: { relationshipId: relationship._id.toString(), screen: '/roommates' },
    });

    res.json({
      message: 'Roommate relationship ended successfully',
      data: { id: relationship._id.toString(), status: relationship.status },
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

module.exports = {
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
