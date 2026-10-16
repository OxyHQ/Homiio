/**
 * Payment tools → `domain/payments.ts`, as the effective account.
 *
 * The ledger's own idempotency key is DERIVED from the capability
 * `Idempotency-Key` ({@link ledgerIdempotencyKey}), so a coordinator's retry is
 * the same ledger movement as well as the same capability receipt. The wrapper
 * in `homiio.handlers.ts` refuses a finance tool without a key before this
 * code runs; the check below only narrows the type.
 */

import {
  confirmRentPayment,
  createLeasePaymentObligation,
  declareRentPayment,
  getLeaseLedger,
  ledgerIdempotencyKey,
  listLeasePayments,
  listMyPayments,
  refundRentPayment,
  rejectRentPayment,
} from '../../domain/payments';
import { AppError } from '../../middlewares/errorHandler';
import * as validation from '../../middlewares/validation';
import { type HomiioToolContext, type HomiioToolHandlers, requiredString } from './context';
import { runRouteValidation } from './routeValidation';
import { dataBody, pageBody } from './tenancyBody';

function ledgerKey(context: HomiioToolContext): string {
  if (context.idempotencyKey === undefined) {
    throw new AppError('This tool requires an Idempotency-Key', 400, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  return ledgerIdempotencyKey(context.idempotencyKey);
}

async function leaseIdOf(input: Readonly<Record<string, unknown>>): Promise<string> {
  const leaseId = requiredString(input, 'leaseId');
  await runRouteValidation(validation.validateLeaseId, { params: { id: leaseId } });
  return leaseId;
}

export const PAYMENT_HANDLERS: HomiioToolHandlers = {
  listMyPayments: async (input, { accountId }) => {
    const result = await listMyPayments(accountId, {
      page: input.page,
      limit: input.limit,
      status: input.status,
    });
    return pageBody(result.payments, result.page, result.limit, result.total);
  },

  listLeasePayments: async (input, { accountId }) => {
    const result = await listLeasePayments(accountId, await leaseIdOf(input), {
      page: input.page,
      limit: input.limit,
      status: input.status,
    });
    return pageBody(result.payments, result.page, result.limit, result.total);
  },

  getLeaseLedger: async (input, { accountId }) =>
    dataBody(await getLeaseLedger(accountId, await leaseIdOf(input))),

  createLeasePaymentObligation: async (input, { accountId }) =>
    dataBody(
      await createLeasePaymentObligation(accountId, await leaseIdOf(input), {
        dueDate: input.dueDate,
        amount: input.amount,
        type: input.type,
        description: input.description,
      }),
    ),

  declareRentPayment: async (input, context) => {
    const outcome = await declareRentPayment(context.accountId, {
      leaseId: await leaseIdOf(input),
      obligationId: requiredString(input, 'obligationId'),
      idempotencyKey: ledgerKey(context),
      amount: input.amount,
      note: input.note,
    });
    return dataBody(outcome.movement);
  },

  confirmRentPayment: async (input, { accountId }) =>
    dataBody(
      await confirmRentPayment(accountId, {
        leaseId: await leaseIdOf(input),
        movementId: requiredString(input, 'movementId'),
      }),
    ),

  rejectRentPayment: async (input, { accountId }) =>
    dataBody(
      await rejectRentPayment(accountId, {
        leaseId: await leaseIdOf(input),
        movementId: requiredString(input, 'movementId'),
        reason: input.reason,
      }),
    ),

  refundRentPayment: async (input, context) => {
    const outcome = await refundRentPayment(context.accountId, {
      leaseId: await leaseIdOf(input),
      movementId: requiredString(input, 'movementId'),
      idempotencyKey: ledgerKey(context),
      amount: input.amount,
      note: input.note,
    });
    return dataBody(outcome.movement);
  },
};
