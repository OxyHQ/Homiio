/**
 * Admin gate.
 *
 * Privileged endpoints (e.g. the `/api/scraper/*` ingestion-management routes)
 * must be restricted to platform admins, not any authenticated Oxy user. This
 * middleware runs AFTER the Oxy auth middleware (so `req.user` is resolved) and
 * allows the request only when the authenticated Oxy user id is on the
 * configured allowlist (`config.admin.oxyUserIds`).
 *
 * An empty allowlist denies everyone — privileged routes stay locked until an
 * admin id is explicitly configured, so a misconfiguration fails closed.
 */

import type { Request, Response, NextFunction } from 'express';
import config from '../config';
import { AppError } from './errorHandler';

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const oxyUserId = req.user?.id || req.user?._id || req.userId || undefined;
  if (!oxyUserId) {
    next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    return;
  }
  if (!config.admin.oxyUserIds.includes(oxyUserId)) {
    next(new AppError('Admin privileges required', 403, 'FORBIDDEN'));
    return;
  }
  next();
}
