/**
 * Roommate Controller
 * Handles roommate matching operations with Oxy user data integration
 */

import type { Request, Response } from 'express';

import { Profile, RoommateRequest } from '../models';
import { ProfileType } from '@homiio/shared-types';
import { logger } from '../middlewares/logging';
import mongoose from 'mongoose';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

const PUBLIC_PROFILE_FIELDS = 'profileType personalProfile isAnonymous';

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

// Get all roommate profiles with enriched Oxy user data
const getRoommateProfiles = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, minMatchPercentage, maxBudget, withPets, nonSmoking, ageRange, gender, location } = req.query;

    // Build base query for personal profiles with roommate matching enabled
    const query: Record<string, unknown> = {
      profileType: ProfileType.PERSONAL, // Only personal profiles can have roommate matching
      'personalProfile.settings.roommate.enabled': true,
      _id: { $ne: req.user?.profileId } // Exclude current user's profile
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

    // Get current user's profile and preferences
    const currentProfile = await Profile.findById(req.user?.profileId);
    const currentUserPrefs = personalOf(currentProfile)?.settings?.roommate?.preferences;

    type EnrichedProfile = Record<string, unknown> & { matchPercentage: number };
    let profilesWithMatches: EnrichedProfile[] = profiles.map((profile) => ({
      ...profile.toObject(),
      matchPercentage: 0,
    }));

    if (currentUserPrefs) {
      profilesWithMatches = profiles.map((profile) => {
        const profilePrefs = personalOf(profile)?.settings?.roommate?.preferences;
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
    const oxyUserId = req.user?.id || req.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if profile is personal type
    if (profile.profileType !== ProfileType.PERSONAL) {
      return res.status(403).json({ error: 'Roommate preferences are only available for personal profiles' });
    }
    
    const prefs = personalOf(profile)?.settings?.roommate?.preferences;
    if (!prefs) {
      return res.json({ data: null });
    }

    res.json({ data: prefs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch roommate preferences' });
  }
};

// Update roommate preferences
const updateRoommatePreferences = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { ageRange, gender, lifestyle, budget, moveInDate, leaseDuration, interests, location, enabled } = req.body;

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if profile is personal type
    if (profile.profileType !== ProfileType.PERSONAL) {
      return res.status(403).json({ error: 'Roommate preferences are only available for personal profiles' });
    }

    const updateData: Record<string, unknown> = {
      'personalProfile.settings.roommate.preferences': {
        ageRange,
        gender,
        lifestyle,
        budget,
        moveInDate,
        leaseDuration,
        interests,
        location,
      },
    };
    if (typeof enabled === 'boolean') {
      updateData['personalProfile.settings.roommate.enabled'] = enabled;
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
    res.status(500).json({ error: 'Failed to update roommate preferences' });
  }
};

// Toggle roommate matching
const toggleRoommateMatching = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { enabled } = req.body;
    const oxyUserId = req.user?.id || req.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if profile is personal type
    if (profile.profileType !== ProfileType.PERSONAL) {
      return res.status(403).json({ error: 'Roommate matching is only available for personal profiles' });
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
    res.status(500).json({ error: 'Failed to toggle roommate matching' });
  }
};

// Get roommate requests
const getRoommateRequests = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if profile is personal type
    if (profile.profileType !== ProfileType.PERSONAL) {
      return res.status(403).json({ error: 'Roommate requests are only available for personal profiles' });
    }

    const [sent, received] = await Promise.all([
      RoommateRequest.find({ fromProfileId: profile._id })
        .populate('toProfileId', PUBLIC_PROFILE_FIELDS)
        .sort({ createdAt: -1 }),
      RoommateRequest.find({ toProfileId: profile._id })
        .populate('fromProfileId', PUBLIC_PROFILE_FIELDS)
        .sort({ createdAt: -1 })
    ]);

    res.json({
      data: {
        sent,
        received
      }
    });
  } catch (error) {
    logger.error('Failed to fetch roommate requests', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate requests' });
  }
};

// Send roommate request
const sendRoommateRequest = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { profileId } = req.params;
    const { message } = req.body;
    const oxyUserId = req.user?.id || req.user?._id;

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get current user's profile
    const currentProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!currentProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if current user has a personal profile
    if (currentProfile.profileType !== ProfileType.PERSONAL) {
      return res.status(403).json({ error: 'Roommate requests are only available for personal profiles' });
    }

    // Get target profile
    const targetProfile = await Profile.findById(profileId);
    
    if (!targetProfile) {
      return res.status(404).json({ error: 'Target profile not found' });
    }

    // Check if target profile is personal
    if (targetProfile.profileType !== ProfileType.PERSONAL) {
      return res.status(400).json({ error: 'Roommate requests can only be sent to personal profiles' });
    }

    if (currentProfile._id.toString() === targetProfile._id.toString()) {
      return res.status(400).json({ error: 'You cannot send a roommate request to yourself' });
    }

    if (!personalOf(targetProfile)?.settings?.roommate?.enabled) {
      return res.status(400).json({ error: 'Target profile does not have roommate matching enabled' });
    }

    const existingRequest = await RoommateRequest.findOne({
      status: 'pending',
      $or: [
        { fromProfileId: currentProfile._id, toProfileId: targetProfile._id },
        { fromProfileId: targetProfile._id, toProfileId: currentProfile._id }
      ]
    });

    if (existingRequest) {
      return res.status(409).json({ error: 'A pending roommate request already exists between these profiles' });
    }

    const request = await RoommateRequest.create({
      fromProfileId: currentProfile._id,
      toProfileId: targetProfile._id,
      message: typeof message === 'string' ? message : undefined
    });

    res.status(201).json({
      message: 'Roommate request sent successfully',
      data: request
    });
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: number }).code === 11000) {
      return res.status(409).json({ error: 'A pending roommate request already exists between these profiles' });
    }
    logger.error('Failed to send roommate request', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to send roommate request' });
  }
};

// Respond to a roommate request (accept/decline) - only the recipient may respond
const respondToRoommateRequest = async (req: Request, res: Response, status: 'accepted' | 'declined'): Promise<Response | void> => {
  const action = status === 'accepted' ? 'accept' : 'decline';
  try {
    const { requestId } = req.params;
    const oxyUserId = req.user?.id || req.user?._id;

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(404).json({ error: 'Roommate request not found' });
    }

    const profile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const request = await RoommateRequest.findOne({
      _id: requestId,
      toProfileId: profile._id,
      status: 'pending'
    });

    if (!request) {
      return res.status(404).json({ error: 'Roommate request not found' });
    }

    request.status = status;
    await request.save();

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
    const oxyUserId = req.user?.id || req.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if profile is personal type
    if (profile.profileType !== ProfileType.PERSONAL) {
      return res.json({
        hasRoommateMatching: false,
        profile: null,
        error: 'Roommate matching is only available for personal profiles'
      });
    }

    const roommateSlice = personalOf(profile)?.settings?.roommate;
    const hasRoommateMatching = Boolean(roommateSlice?.enabled);

    // Remove Oxy user data fetching and just return profile info
    res.json({
      hasRoommateMatching,
      profile: profile ? {
        id: profile._id,
        profileType: profile.profileType,
        roommatePreferences: roommateSlice?.preferences || null,
      } : null,
    });
  } catch (error) {
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
  getCurrentUserRoommateStatus
}; 