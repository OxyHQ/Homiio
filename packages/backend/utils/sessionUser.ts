import { getRequiredOxyUserId } from '@oxy.so/core/server';
import { AppError } from '../middlewares/errorHandler';
import type { Request } from 'express';

/** Session-scoped Oxy user id — sole ownership authority for Homiio writes. */
export function requireSessionOxyUserId(req: Request): string {
  try {
    return getRequiredOxyUserId(req);
  } catch {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
}
