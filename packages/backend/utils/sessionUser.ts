import { getRequiredOxyUserId, type OxyAuthRequest } from '@oxyhq/core/server';
import type { Request } from 'express';

import { AppError } from '../middlewares/errorHandler';

/** Session account id — the active Oxy user after switchToAccount (Mention pattern). */
export function requireSessionOxyUserId(req: Request): string {
  try {
    return getRequiredOxyUserId(req as OxyAuthRequest);
  } catch {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
}

/** Optional session account id when auth is not required. */
export function optionalSessionOxyUserId(req: Request): string | undefined {
  const authed = req as OxyAuthRequest & { userId?: string };
  return authed.user?.id || authed.user?._id || authed.userId;
}
