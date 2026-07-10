import { Profile, Saved, SavedPropertyFolder, SavedSearch, RecentlyViewed, Property } from '../../models';
import { successResponse } from '../../middlewares/errorHandler';

const errorResponse = (message = 'Error occurred', code = 'ERROR') => ({
  success: false,
  message,
  code,
  timestamp: new Date().toISOString(),
});

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 1000;
const profileCache = new Map<string, { data: unknown; timestamp: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of profileCache) {
    if (now - entry.timestamp >= CACHE_TTL) profileCache.delete(key);
  }
}, 60_000).unref();

function _getOxyUserId(req: { user?: { id?: string; _id?: string } }): string | undefined {
  return req?.user?.id || req?.user?._id;
}

async function _createDefaultProfile(oxyUserId: string) {
  const profile = new Profile({
    oxyUserId,
    personalProfile: {
      personalInfo: {
        bio: '',
        occupation: '',
        employer: '',
        annualIncome: null,
        employmentStatus: null,
        moveInDate: null,
        leaseDuration: null,
      },
      preferences: {},
      references: [],
      rentalHistory: [],
      verification: {},
      settings: {
        notifications: { email: true, push: true, sms: false },
        privacy: { profileVisibility: 'public', showContactInfo: true, showIncome: false },
        language: 'en',
        timezone: 'UTC',
      },
    },
  });
  await profile.save();
  return profile;
}

function getCacheKey(oxyUserId: string) {
  return oxyUserId;
}

function getCachedProfile<T = unknown>(oxyUserId: string): T | null {
  const key = getCacheKey(oxyUserId);
  const cached = profileCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T;
  }

  return null;
}

function setCachedProfile(oxyUserId: string, data: unknown) {
  const key = getCacheKey(oxyUserId);
  profileCache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

function clearCachedProfile(oxyUserId: string) {
  const key = getCacheKey(oxyUserId);
  profileCache.delete(key);
}

export {
  Profile,
  Saved,
  SavedPropertyFolder,
  SavedSearch,
  RecentlyViewed,
  Property,
  successResponse,
  errorResponse,
  profileCache,
  CACHE_TTL,
  CACHE_MAX_SIZE,
  _getOxyUserId,
  _createDefaultProfile,
  getCacheKey,
  getCachedProfile,
  setCachedProfile,
  clearCachedProfile,
};
