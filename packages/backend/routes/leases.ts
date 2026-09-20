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
import multer from 'multer';
import * as leasePaymentController from '../controllers/leasePaymentController';
import { asyncHandler } from '../middlewares';
import handleUploadError from '../middlewares/uploadMiddleware';
import * as validation from '../middlewares/validation';
const { leaseController } = controllers;

/**
 * A tenancy document arrives as a FILE, and a PDF is the ordinary case.
 *
 * It used to arrive as a URL string the client had already uploaded to the
 * public image endpoint — which both published the document and let a party
 * point a lease row at any address at all. The bytes come here instead.
 *
 * The allowlist admits PDFs deliberately: a tenancy agreement, an addendum and
 * an insurance certificate are PDFs far more often than photographs, and the
 * old path could not accept one because the image picker and the Sharp
 * re-encode both refused it. `controllers/leaseController.ts` splits on the
 * type — PDFs stored verbatim, images re-encoded — and holds the matching
 * extension map, so a type added here must be added there too.
 *
 * 10 MB, one file per request: the same cap `routes/applications.ts` uses, and
 * the bound that keeps a base64 response about 13 MB. One file at a time means
 * a partial failure loses one document rather than a batch.
 */
const LEASE_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (LEASE_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Invalid file type. Only PDF and common image formats are allowed.'));
  },
});

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
  // A receipt for a settled payment. Declared before the `/:id` matcher for the
  // same reason the rest of this file is: a static segment must never be
  // swallowed by a parameter.
  router.get(
    '/:id/movements/:movementId/receipt',
    validation.validateLeaseId,
    asyncHandler(leasePaymentController.getReceipt),
  );
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
  // The bytes of ONE document, to a party to the lease and to nobody else
  // (#518 §7.4). Declared before `/:id/documents` POST only for readability —
  // what matters is that it is on THIS router, the authenticated one, which is
  // where `AGENTS.md` says the authorization decision is made. These documents
  // used to be delivered by `routes/public.ts`.
  router.get(
    '/:id/documents/:documentId',
    validation.validateLeaseId,
    asyncHandler(leaseController.getLeaseDocument),
  );
  router.post(
    '/:id/documents',
    documentUpload.single('document'),
    handleUploadError,
    validation.validateLeaseId,
    asyncHandler(leaseController.uploadLeaseDocument),
  );
  router.post('/:id/sign', validation.validateLeaseId, asyncHandler(leaseController.signLease));
  router.post('/:id/terminate', validation.validateLeaseId, asyncHandler(leaseController.terminateLease));
  router.post('/:id/renew', validation.validateLeaseId, asyncHandler(leaseController.renewLease));

  router.get('/:id', validation.validateLeaseId, asyncHandler(leaseController.getLeaseById));
  router.put('/:id', validation.validateLeaseUpdate, asyncHandler(leaseController.updateLease));
  router.delete('/:id', validation.validateLeaseId, asyncHandler(leaseController.deleteLease));

  return router;
};
