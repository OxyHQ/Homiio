import type { Request } from 'express';
import { getRequiredOxyUserId } from '@oxyhq/core/server';

/** Session Oxy account id — sole authority for Homiio ownership (Mention pattern). */
export function requireSessionOxyUserId(req: Request): string {
  return getRequiredOxyUserId(req);
}
