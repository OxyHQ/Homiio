/**
 * The rent ledger's HTTP surface (#518 §7.2, #519 §7.2) — the adapter over
 * `domain/payments.ts`, which holds every rule (declare / confirm / reject /
 * refund, amounts resolved against what is outstanding, idempotency keys) and
 * which the catalogue tools call too.
 *
 * There is no "Pay rent" route: Homiio has no processor
 * (`docs/peable-rent-payments.md`), and a button that opened a checkout Homiio
 * cannot settle would be the simulated success both epics forbid.
 */

import type { NextFunction, Request, Response } from 'express';

import {
  confirmRentPayment,
  declareRentPayment,
  getLeaseLedger,
  readRentReceipt,
  refundRentPayment,
  rejectRentPayment,
} from '../domain/payments';
import { successResponse } from '../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../utils/sessionUser';

/** `GET /api/leases/:id/ledger` — every movement, and what each obligation stands at. */
export async function getLedger(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const ledger = await getLeaseLedger(oxyUserId, String(req.params.id));
    res.json(successResponse(ledger, 'Lease payment ledger retrieved'));
  } catch (error) {
    next(error);
  }
}

/**
 * The language to render a receipt in: `Accept-Language`'s first tag,
 * validated before it reaches `Intl` (an arbitrary value throws a
 * `RangeError` there). English when there is nothing usable.
 */
function receiptLocale(req: Request): string {
  const header = req.headers['accept-language'];
  const first = (typeof header === 'string' ? header : '').split(',')[0]?.trim() ?? '';
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(first) ? first : 'en';
}

/**
 * `GET /api/leases/:id/movements/:movementId/receipt` — a receipt for rent that
 * actually settled, base64 in the ordinary envelope (the Oxy linked client is
 * JSON-only), `Cache-Control: private, no-store`.
 */
export async function getReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const receipt = await readRentReceipt(
      oxyUserId,
      String(req.params.id),
      String(req.params.movementId),
      receiptLocale(req),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(successResponse(receipt, 'Receipt retrieved'));
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/leases/:id/obligations/:obligationId/declarations` — the tenant
 * says they paid. 201 for a new declaration, 200 for a deduped retry.
 */
export async function declarePayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const outcome = await declareRentPayment(oxyUserId, {
      leaseId: String(req.params.id),
      obligationId: String(req.params.obligationId),
      idempotencyKey: req.body?.idempotencyKey,
      amount: req.body?.amount,
      note: req.body?.note,
    });
    res
      .status(outcome.deduped ? 200 : 201)
      .json(
        successResponse(
          outcome.movement,
          outcome.deduped ? 'Payment already declared' : 'Payment declared',
        ),
      );
  } catch (error) {
    next(error);
  }
}

/** `POST /api/leases/:id/movements/:movementId/confirm` — the landlord agrees the money arrived. */
export async function confirmPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const movement = await confirmRentPayment(oxyUserId, {
      leaseId: String(req.params.id),
      movementId: String(req.params.movementId),
    });
    res.json(successResponse(movement, 'Payment confirmed'));
  } catch (error) {
    next(error);
  }
}

/** `POST /api/leases/:id/movements/:movementId/reject` — the money did not arrive. */
export async function rejectPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const movement = await rejectRentPayment(oxyUserId, {
      leaseId: String(req.params.id),
      movementId: String(req.params.movementId),
      reason: req.body?.reason,
    });
    res.json(successResponse(movement, 'Payment rejected'));
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/leases/:id/movements/:movementId/refunds` — money going back, as a
 * NEW movement. 201 for a new refund, 200 for a deduped retry.
 */
export async function refundPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const outcome = await refundRentPayment(oxyUserId, {
      leaseId: String(req.params.id),
      movementId: String(req.params.movementId),
      idempotencyKey: req.body?.idempotencyKey,
      amount: req.body?.amount,
      note: req.body?.note,
    });
    res
      .status(outcome.deduped ? 200 : 201)
      .json(
        successResponse(
          outcome.movement,
          outcome.deduped ? 'Refund already recorded' : 'Refund recorded',
        ),
      );
  } catch (error) {
    next(error);
  }
}
