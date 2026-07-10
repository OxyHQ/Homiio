import { getRequiredOxyUserId } from '@oxyhq/core/server';
import { AppError } from '../middlewares/errorHandler';
import type { ControllerRequest } from '../controllers/controllerTypes';

/** Session-scoped Oxy user id — sole ownership authority for Homiio writes. */
export function requireSessionOxyUserId(req: ControllerRequest): string {
  try {
    return getRequiredOxyUserId(req);
  } catch {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
}
