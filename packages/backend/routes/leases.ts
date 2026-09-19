/**
 * Lease Routes
 *
 * Mounted at /api/leases (authenticated via global oxy.auth() in server.ts).
 * Static sub-resource routes are declared before the `/:id` params so a path
 * segment like `payments` is never swallowed by the id matcher. List filtering
 * is done with query params (`?status=`, `?propertyId=`) — there are no
 * `/active` or `/pending-signature` convenience routes.
 */

import * as controllers from '../controllers';
import express from 'express';
import * as leasePaymentController from '../controllers/leasePaymentController';
import { asyncHandler } from '../middlewares';
import * as validation from '../middlewares/validation';
const { leaseController } = controllers;

export default function() {
  const router = express.Router();

  router.get('/', validation.validateLeaseListQuery, asyncHandler(leaseController.getLeases));
  router.post('/', validation.validateLeaseCreate, asyncHandler(leaseController.createLease));

  // Sub-resource + lifecycle routes (static-segment first).
  router.get('/:id/payments', validation.validateLeaseId, asyncHandler(leaseController.getLeasePayments));
  router.post('/:id/payments', validation.validateLeaseId, asyncHandler(leaseController.createPayment));
  // ── The rent LEDGER (#518 §7.2, #519 §7.2) ──────────────────────────────
  //
  // `/:id/payments` above is the OBLIGATION list — what is owed. These are the
  // MOVEMENTS against it: what a tenant says they paid, what a landlord
  // confirmed, and what went back. The two are deliberately separate paths,
  // because conflating "due" with "paid" is the confusion the ledger exists to
  // end.
  //
  // There is no processor route. See `controllers/leasePaymentController.ts`
  // and `docs/housing-parity.md`.
  router.get('/:id/ledger', validation.validateLeaseId, asyncHandler(leasePaymentController.getLedger));
  router.post(
    '/:id/obligations/:obligationId/declarations',
    validation.validateLeaseId,
    asyncHandler(leasePaymentController.declarePayment),
  );
  router.post(
    '/:id/movements/:movementId/confirm',
    validation.validateLeaseId,
    asyncHandler(leasePaymentController.confirmPayment),
  );
  router.post(
    '/:id/movements/:movementId/reject',
    validation.validateLeaseId,
    asyncHandler(leasePaymentController.rejectPayment),
  );
  router.post(
    '/:id/movements/:movementId/refunds',
    validation.validateLeaseId,
    asyncHandler(leasePaymentController.refundPayment),
  );

  router.get('/:id/documents', validation.validateLeaseId, asyncHandler(leaseController.getLeaseDocuments));
  router.post('/:id/documents', validation.validateLeaseId, asyncHandler(leaseController.uploadLeaseDocument));
  router.post('/:id/sign', validation.validateLeaseId, asyncHandler(leaseController.signLease));
  router.post('/:id/terminate', validation.validateLeaseId, asyncHandler(leaseController.terminateLease));
  router.post('/:id/renew', validation.validateLeaseId, asyncHandler(leaseController.renewLease));

  router.get('/:id', validation.validateLeaseId, asyncHandler(leaseController.getLeaseById));
  router.put('/:id', validation.validateLeaseUpdate, asyncHandler(leaseController.updateLease));
  router.delete('/:id', validation.validateLeaseId, asyncHandler(leaseController.deleteLease));

  return router;
};
