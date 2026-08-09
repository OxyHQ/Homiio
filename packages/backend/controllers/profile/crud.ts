/**
 * The RE sidecar profile — one per Oxy account, served from Postgres.
 *
 * `db/profiles/profileRepository.ts` carries the measurement this port rests on
 * (five rows in Mongo, the same five in Postgres) and the reason the table is
 * that small. This file is the HTTP edge: it resolves the caller, decides who is
 * looking, and hands the repository an allow-listed write.
 *
 * ## The five-minute in-process cache is GONE, deliberately
 *
 * `shared.ts` kept a `Map` of profiles for 300 seconds, cleared on the owner's
 * own `PUT`. It existed because a Mongo profile read loaded a whole document
 * with an unbounded `chatHistory` array inside it; the Postgres read is one
 * lookup on a unique index over a five-row table plus five small child reads.
 *
 * It was also WRONG, and would have stayed wrong: Homiio runs several ECS tasks,
 * so a `PUT` served by one task cleared that task's copy and left every other
 * task serving the pre-edit profile for up to five minutes. A cache with one
 * invalidation path per process is a cache that can only be correct in a single
 * process. Removing it is a behaviour change and this is where it is stated.
 */

import { getDb } from '../../db/postgres';
import {
  ensureProfile,
  findHydratedProfile,
  updateProfile,
} from '../../db/profiles/profileRepository';
import { toProfileDTO } from '../../db/profiles/profileSerializer';
import { errorResponse, successResponse, _getOxyUserId } from './shared';
import { toProfileUpdate } from './profileWriteColumns';
import type { NextFunction, Request, Response } from 'express';

/**
 * The caller's own profile, created empty if this is their first request.
 *
 * `?minimal=true` used to skip a second full document load; there is no second
 * load to skip now, so the parameter is accepted and ignored rather than
 * removed — a shipped client still sends it, and a 400 for a parameter that used
 * to be free would be a wire break.
 */
export async function getOrCreateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = _getOxyUserId(req);
    if (!oxyUserId) {
      return res
        .status(401)
        .json(errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'));
    }

    const hydrated = await ensureProfile(getDb(), oxyUserId, 'owner');
    res.json(successResponse(toProfileDTO(hydrated, 'owner'), 'Profile retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * Somebody else's profile, read-only, with the private blocks withheld.
 *
 * The `public` scope is what makes the withholding happen — see
 * `db/profiles/profileSerializer.ts`, which states which flag gates which block
 * and why the landlord contact is gated separately from the tenancy it sits on.
 *
 * This handler is mounted both behind auth (`/api/profiles/oxy/:oxyUserId`) and
 * WITHOUT it (`/api/public/profiles/*`), so it treats every caller as a stranger
 * rather than trying to work out whether the request happened to carry a
 * session. A person reading their own profile through the public route gets the
 * public view, which is the honest answer for a route named `public`.
 */
export async function getPublicProfileByOxyUserId(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { oxyUserId } = req.params;
    if (!oxyUserId) {
      return res.status(400).json(errorResponse('Oxy user id is required', 'OXY_USER_ID_REQUIRED'));
    }

    const hydrated = await findHydratedProfile(getDb(), oxyUserId);
    if (!hydrated) {
      return res.status(404).json(errorResponse('Profile not found', 'PROFILE_NOT_FOUND'));
    }

    res.json(successResponse(toProfileDTO(hydrated, 'public'), 'Profile retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/** `GET /api/profiles/oxy/:oxyUserId` — the same public read, under its own route. */
export async function getProfileByOxyUserId(req: Request, res: Response, next: NextFunction) {
  return getPublicProfileByOxyUserId(req, res, next);
}

/**
 * Update the caller's own profile.
 *
 * The owner comes from the session and never from the body, and the body is
 * mapped through `profileWriteColumns.ts`'s allow-list before it reaches a
 * column — `AGENTS.md`'s write-safety rule, and the reason no `oxyUserId`,
 * `id`, `createdAt` or `updatedAt` from a request can land on the row.
 *
 * ONE transaction: `updateProfile` may create the row, rewrite scalar columns
 * and replace up to four child collections, and a partial application of that
 * would leave a person's references belonging to a state that was never saved.
 */
export async function updateMyProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = _getOxyUserId(req);
    if (!oxyUserId) {
      return res
        .status(401)
        .json(errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'));
    }

    const update = toProfileUpdate(req.body);
    const hydrated = await getDb().transaction((tx) =>
      updateProfile(tx, oxyUserId, update, 'owner'),
    );

    res.json(successResponse(toProfileDTO(hydrated, 'owner'), 'Profile updated successfully'));
  } catch (error) {
    next(error);
  }
}
