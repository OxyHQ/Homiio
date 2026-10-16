/**
 * A person's guest-points standing and the movements it is computed from.
 *
 * READ ONLY by design: points are earned by hosting and spent by staying, so
 * every write belongs to the exchange lifecycle (`controllers/guestPointsController.ts`
 * says why). Scoped to the `oxyUserId` given in the repository query — a
 * balance is a record of where somebody stayed and whom they hosted, and it is
 * nobody else's to read.
 */

import { guestPointStanding } from '@homiio/shared-types';

import { listMovements, toMovementDTO } from '../db/guestPoints/guestPointsLedger';
import { getDb } from '../db/postgres';

export async function getMyGuestPoints(oxyUserId: string) {
  const movements = (await listMovements(getDb(), oxyUserId)).map(toMovementDTO);
  return { balance: guestPointStanding(movements), movements };
}
