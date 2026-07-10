import {
  Profile,
  Saved,
  SavedPropertyFolder,
  SavedSearch,
  RecentlyViewed,
  Property,
} from '../../models';
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

function getCacheKey(oxyUserId: string, type = 'profile') {
  return `${oxyUserId}:${type}`;
}

function getCachedProfile<T = unknown>(oxyUserId: string, type = 'profile'): T | null {
  const key = getCacheKey(oxyUserId, type);
  const cached = profileCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T;
  }
  return null;
}

function setCachedProfile(oxyUserId: string, data: unknown, type = 'profile') {
  profileCache.set(getCacheKey(oxyUserId, type), { data, timestamp: Date.now() });
}

function clearCachedProfile(oxyUserId: string, type = 'profile') {
  profileCache.delete(getCacheKey(oxyUserId, type));
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
  getCacheKey,
  getCachedProfile,
  setCachedProfile,
  clearCachedProfile,
};
