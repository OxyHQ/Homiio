import { Profile } from '../../models';
import { successResponse } from '../../middlewares/errorHandler';
import { ProfileType } from '@homiio/shared-types';
import { Saved, SavedPropertyFolder, SavedSearch, RecentlyViewed, Property } from '../../models';

// Create a simple errorResponse function since it's not exported from errorHandler
const errorResponse = (message = 'Error occurred', code = 'ERROR') => {
  return {
    success: false,
    message,
    code,
    timestamp: new Date().toISOString()
  };
};

// Simple in-memory cache for profile data
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 1000;
const profileCache = new Map<string, { data: unknown; timestamp: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of profileCache) {
    if (now - entry.timestamp >= CACHE_TTL) profileCache.delete(key);
  }
}, 60_000).unref();

/**
 * Internal: extract oxyUserId from request safely
 */
function _getOxyUserId(req: any): string | undefined {
  return req?.user?.id || req?.user?._id;
}

/**
 * Internal: create and activate a minimal personal profile for a user.
 * Centralized to avoid duplicating defaults across endpoints.
 * Only used when explicitly creating or ensuring an active profile.
 */
async function _createDefaultPersonalProfile(oxyUserId: string) {
  const personal = new Profile({
    oxyUserId,
    profileType: ProfileType.PERSONAL,
    isActive: true,
    isPrimary: true,
    personalProfile: {
      personalInfo: {
        bio: "",
        occupation: "",
        employer: "",
        annualIncome: null,
        employmentStatus: null,
        moveInDate: null,
        leaseDuration: null,
      },
      preferences: {},
      references: [],
      rentalHistory: [],
      verification: {},
      trustScore: { score: 50, factors: [] },
      settings: {
        notifications: { email: true, push: true, sms: false },
        privacy: { profileVisibility: "public", showContactInfo: true, showIncome: false },
        language: "en",
        timezone: "UTC",
      },
    },
  });
  personal.calculateTrustScore?.();
  await personal.save();
  return personal;
}

/**
 * Get cache key for profile
 */
function getCacheKey(oxyUserId: string, type = 'active') {
  return `${oxyUserId}:${type}`;
}

/**
 * Get cached profile data
 */
function getCachedProfile<T = unknown>(oxyUserId: string, type = 'active'): T | null {
  const key = getCacheKey(oxyUserId, type);
  const cached = profileCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T;
  }

  return null;
}

/**
 * Set cached profile data
 */
function setCachedProfile(oxyUserId: string, data: unknown, type = 'active') {
  const key = getCacheKey(oxyUserId, type);
  profileCache.set(key, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Clear cached profile data
 */
function clearCachedProfile(oxyUserId: string, type = 'active') {
  const key = getCacheKey(oxyUserId, type);
  profileCache.delete(key);
}

export {
  Profile,
  Saved,
  SavedPropertyFolder,
  SavedSearch,
  RecentlyViewed,
  Property,
  ProfileType,
  successResponse,
  errorResponse,
  profileCache,
  CACHE_TTL,
  CACHE_MAX_SIZE,
  _getOxyUserId,
  _createDefaultPersonalProfile,
  getCacheKey,
  getCachedProfile,
  setCachedProfile,
  clearCachedProfile,
};
