/**
 * The client for the guest-points ledger (#518 §7.5, #519 §7.5).
 *
 * ## One read, and no write
 *
 * There is no `spend`, `buy`, `gift` or `transfer` method here, because there
 * is no such endpoint and there never will be. Points move only through the
 * exchange lifecycle — requesting a points stay reserves, the host accepting
 * settles, declining or cancelling releases — so the write path is
 * `exchangeService.createRequest` and `exchangeService.updateStatus`.
 *
 * ## The reservation's idempotency key is minted HERE
 *
 * Not by the screen. A component that minted its own would mint a NEW one on
 * every render, which is the same as not having one — and the whole point is
 * that the second attempt carries the first one's.
 * {@link guestPointsIdempotencyKeyFor} derives it from what the request is
 * ABOUT, so a double tap, a retry after a timeout and a resubmit after a reload
 * all produce the same key and therefore the same reservation.
 */

import type { GuestPointBalance, GuestPointMovement } from '@homiio/shared-types';

import { api, type ApiResponse } from '@/utils/api';

export interface GuestPointsLedger {
  readonly balance: GuestPointBalance;
  readonly movements: readonly GuestPointMovement[];
}

/**
 * A stable key for one intent to book one stay.
 *
 * Derived from the parts that identify WHAT is being asked for — the listing
 * and the exact window — so the same intent always produces the same key and a
 * different one always produces a different key. A guest who asks for the same
 * home over the same dates twice meant it once.
 *
 * Deliberately NOT random and NOT time-based: both make every attempt unique,
 * which is exactly the property an idempotency key exists to destroy.
 */
export function guestPointsIdempotencyKeyFor(
  propertyId: string,
  start: string,
  end: string,
): string {
  // Dates reduced to their calendar day: the wire carries a full ISO instant,
  // and two taps a second apart must not read as two different intents.
  const day = (value: string) => value.slice(0, 10).replace(/-/g, '');
  return `gp-${propertyId}-${day(start)}-${day(end)}`
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 64);
}

class GuestPointsService {
  /** My balance, and every movement behind it. */
  async get(): Promise<GuestPointsLedger> {
    const { data } = await api.get<ApiResponse<GuestPointsLedger>>('/api/guest-points');
    if (!data.data) throw new Error('The guest-points response carried no data.');
    return data.data;
  }
}

export const guestPointsService = new GuestPointsService();
