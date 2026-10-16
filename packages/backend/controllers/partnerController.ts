/**
 * Partner Controller — the HTTP edge of the Partner (agent) referral program.
 *
 *   POST /api/partners/join          — idempotent opt-in; mints a referral code.
 *   GET  /api/partners/me            — partner profile + referral link + stats.
 *   GET  /api/partners/me/referrals  — properties sourced by the partner.
 *   GET  /api/partners/me/earnings   — the partner's commission ledger.
 *
 * The program itself lives in `domain/partners.ts`, which the capability
 * catalogue calls too; this file only resolves the session and answers.
 */

import type { NextFunction, Request, Response } from 'express';

import {
  getMyPartnerEarnings,
  getMyPartnerStatus,
  joinPartnerProgram,
  listMyReferrals,
} from '../domain/partners';
import { AppError, successResponse } from '../middlewares/errorHandler';

/** Extract the authenticated Oxy user id from a request, or null. */
function getOxyUserId(req: Request): string | null {
  const id = req.user?.id || req.user?._id || req.userId;
  return id ? String(id) : null;
}

/** Best-effort display name/username for seeding a partner's referral slug. */
function getDisplayName(req: Request): string | undefined {
  const user = req.user as
    | { name?: { full?: unknown; first?: unknown }; username?: unknown }
    | null
    | undefined;
  if (!user) return undefined;
  const full = user.name?.full;
  if (typeof full === 'string' && full.trim()) return full;
  const first = user.name?.first;
  if (typeof first === 'string' && first.trim()) return first;
  if (typeof user.username === 'string' && user.username.trim()) return user.username;
  return undefined;
}

class PartnerController {
  /** POST /api/partners/join — always the full `PartnerMeResponse`. */
  async join(req: Request, res: Response, next: NextFunction) {
    try {
      const oxyUserId = getOxyUserId(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }
      const { created, payload } = await joinPartnerProgram(oxyUserId, {
        displayName: getDisplayName(req),
      });
      return created
        ? res.status(201).json(successResponse(payload, 'Welcome to the Homiio partner program'))
        : res.status(200).json(successResponse(payload, 'Already a partner'));
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/partners/me — zeroed stats and null partner/link when not joined. */
  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const oxyUserId = getOxyUserId(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }
      return res.json(successResponse(await getMyPartnerStatus(oxyUserId), 'Partner profile'));
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/partners/me/referrals — an empty list when the user has not joined. */
  async referrals(req: Request, res: Response, next: NextFunction) {
    try {
      const oxyUserId = getOxyUserId(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }
      const { joined, properties } = await listMyReferrals(oxyUserId);
      return res.json(
        successResponse({ properties }, joined ? 'Partner referrals' : 'No referrals'),
      );
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/partners/me/earnings — an empty list when the user has not joined. */
  async earnings(req: Request, res: Response, next: NextFunction) {
    try {
      const oxyUserId = getOxyUserId(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }
      const { joined, commissions } = await getMyPartnerEarnings(oxyUserId);
      return res.json(
        successResponse({ commissions }, joined ? 'Partner earnings' : 'No earnings'),
      );
    } catch (error) {
      next(error);
    }
  }
}

export default new PartnerController();
