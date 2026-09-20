/**
 * The client for the rent ledger (#518 §7.2, #519 §7.2).
 *
 * ## Every write carries an idempotency key this module mints
 *
 * Not the caller's. A screen that minted its own would mint a NEW one on every
 * render, which is the same as not having one — and the whole point of the key
 * is that the second attempt carries the first one's. {@link idempotencyKeyFor}
 * derives it from what the request is ABOUT, so a double tap, a retry after a
 * timeout and a resubmit after a reload all produce the same key.
 *
 * Transport failures propagate, as everywhere else in this package.
 */

import type {
  LeaseObligationSummary,
  LeasePaymentMovement,
} from '@homiio/shared-types';

import { api, type ApiResponse } from '@/utils/api';

export interface LeaseLedger {
  readonly movements: readonly LeasePaymentMovement[];
  readonly obligations: readonly LeaseObligationSummary[];
}

/**
 * A stable key for one intent.
 *
 * Derived from the parts that identify WHAT is being done — the action, the
 * obligation or movement, and the amount — so the same intent always produces
 * the same key and a different one always produces a different key.
 *
 * Deliberately NOT random and deliberately NOT time-based: both make every
 * attempt unique, which is exactly the property an idempotency key exists to
 * destroy. A tenant who taps "I've paid" twice, or whose request times out and
 * retries, sends the same key and gets the same movement.
 *
 * The amount is included because declaring €400 and then €500 against the same
 * obligation are two different intents, and a key that ignored it would fold
 * the second into the first.
 */
export function idempotencyKeyFor(
  action: 'declare' | 'refund',
  subjectId: string,
  amount: number | undefined,
): string {
  // The subject id already carries a uuid's worth of entropy; the amount is
  // normalised to cents so 400 and 400.0 do not read as different intents.
  const cents = amount === undefined ? 'full' : String(Math.round(amount * 100));
  return `${action}-${subjectId}-${cents}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

class LeaseLedgerService {
  async get(leaseId: string): Promise<LeaseLedger> {
    const { data } = await api.get<ApiResponse<LeaseLedger>>(`/api/leases/${leaseId}/ledger`);
    if (!data.data) throw new Error('The ledger response carried no data.');
    return data.data;
  }

  /** The tenant says they paid. Creates a PENDING movement; settles nothing. */
  async declare(input: {
    readonly leaseId: string;
    readonly obligationId: string;
    readonly amount?: number;
    readonly note?: string;
  }): Promise<LeasePaymentMovement> {
    const { data } = await api.post<ApiResponse<LeasePaymentMovement>>(
      `/api/leases/${input.leaseId}/obligations/${input.obligationId}/declarations`,
      {
        idempotencyKey: idempotencyKeyFor('declare', input.obligationId, input.amount),
        ...(input.amount === undefined ? {} : { amount: input.amount }),
        ...(input.note ? { note: input.note } : {}),
      },
    );
    if (!data.data) throw new Error('The declaration response carried no movement.');
    return data.data;
  }

  /** The landlord agrees the money arrived. The ONE thing that moves a balance. */
  async confirm(leaseId: string, movementId: string): Promise<LeasePaymentMovement> {
    const { data } = await api.post<ApiResponse<LeasePaymentMovement>>(
      `/api/leases/${leaseId}/movements/${movementId}/confirm`,
      {},
    );
    if (!data.data) throw new Error('The confirmation response carried no movement.');
    return data.data;
  }

  /** The landlord says it did not arrive, with a reason the tenant will read. */
  async reject(leaseId: string, movementId: string, reason: string): Promise<LeasePaymentMovement> {
    const { data } = await api.post<ApiResponse<LeasePaymentMovement>>(
      `/api/leases/${leaseId}/movements/${movementId}/reject`,
      { reason },
    );
    if (!data.data) throw new Error('The rejection response carried no movement.');
    return data.data;
  }

  /**
   * Where to ASK for a settled payment's receipt.
   *
   * A path, not a link: the bytes come from a handler that checks the viewer is
   * a party to the lease, so neither `window.open` nor `Linking.openURL` can
   * reach it. `openPrivateDocument` fetches and hands off.
   */
  receiptPath(leaseId: string, movementId: string): string {
    return `/api/leases/${leaseId}/movements/${movementId}/receipt`;
  }

  /** Money going back. A new movement; the original payment survives. */
  async refund(input: {
    readonly leaseId: string;
    readonly movementId: string;
    readonly amount?: number;
    readonly note?: string;
  }): Promise<LeasePaymentMovement> {
    const { data } = await api.post<ApiResponse<LeasePaymentMovement>>(
      `/api/leases/${input.leaseId}/movements/${input.movementId}/refunds`,
      {
        idempotencyKey: idempotencyKeyFor('refund', input.movementId, input.amount),
        ...(input.amount === undefined ? {} : { amount: input.amount }),
        ...(input.note ? { note: input.note } : {}),
      },
    );
    if (!data.data) throw new Error('The refund response carried no movement.');
    return data.data;
  }
}

export const leaseLedgerService = new LeaseLedgerService();
