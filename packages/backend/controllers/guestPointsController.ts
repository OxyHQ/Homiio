/**
 * The guest-points HTTP surface (#518 §7.5, #519 §7.5).
 *
 * ## READ ONLY, and that is the design rather than an omission
 *
 * There is no endpoint here that creates, grants, transfers, buys or adjusts a
 * point, and there never will be. Points are earned by hosting and spent by
 * staying, so every WRITE belongs to the exchange lifecycle and lives in
 * `exchangeController`: creating a points request reserves, accepting settles,
 * declining or cancelling releases, and `services/cron.ts` releases the ones
 * nobody ever answered.
 *
 * A module with a write endpoint would be the first half of every shape
 * #518 §7.5 forbids. `POST /api/guest-points` has nothing it could honestly do.
 *
 * ## What the balance is FOR
 *
 * One response carrying the standing and the movements it was computed from,
 * rather than two endpoints — the rent ledger's reasoning, unchanged: a balance
 * read separately from its own inputs is a balance that can be a request
 * behind, and deriving it exists precisely so the two agree.
 *
 * `neverMoved` travels with it so a surface can tell a new member the truthful
 * thing — *"you need to host before you can stay"* — instead of showing them a
 * zero that looks like a balance they spent.
 */

import type { NextFunction, Request, Response } from 'express';
import { guestPointStanding } from '@homiio/shared-types';

import { getDb } from '../db/postgres';
import { listMovements, toMovementDTO } from '../db/guestPoints/guestPointsLedger';
import { successResponse } from '../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../utils/sessionUser';

/**
 * `GET /api/guest-points` — my balance, and every movement behind it.
 *
 * Scoped to the SESSION account in the repository query. There is no
 * `?oxyUserId=` and no path parameter naming somebody else: a points balance is
 * a record of where a person has stayed and who they have hosted, and it is
 * nobody else's to read.
 */
export async function getMyGuestPoints(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const movements = (await listMovements(getDb(), oxyUserId)).map(toMovementDTO);
    res.json(
      successResponse(
        { balance: guestPointStanding(movements), movements },
        'Guest points retrieved',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export default { getMyGuestPoints };
