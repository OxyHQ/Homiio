/**
 * Tenant Application Routes
 *
 * Mounted at /api/applications (authenticated via global oxy.auth() in server.ts).
 * Handles long-term rent applications (Idealista-style).
 */

import express from 'express';
import multer from 'multer';
import { asyncHandler } from '../middlewares';
import handleUploadError from '../middlewares/uploadMiddleware';
import { requireFilesWithinBudget } from '../middlewares/uploadBudget';
import applicationController from '../controllers/applicationController';
import * as validation from '../middlewares/validation';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_COUNT,
} from '../domain/applications';

const documentUpload = multer({
  storage: multer.memoryStorage(),
  // Per file and per request; the request's TOTAL is checked after multer
  // (`middlewares/uploadBudget.ts`). An application holds up to
  // MAX_DOCUMENT_COUNT documents across its requests: the app sends what fits
  // with the submission and the rest to `POST /:id/documents`.
  limits: {
    fileSize: MAX_DOCUMENT_BYTES,
    files: MAX_DOCUMENT_COUNT,
    fields: 32,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and common image formats are allowed.'));
    }
  },
});

export default function () {
  const router = express.Router();

  // POST /api/applications — applicant submits long-term application
  // Accepts either application/json or multipart/form-data with `documents[]` files.
  router.post(
    '/',
    documentUpload.array('documents', MAX_DOCUMENT_COUNT),
    handleUploadError,
    requireFilesWithinBudget,
    validation.validateTenantApplication,
    asyncHandler(applicationController.createApplication),
  );

  // POST /api/applications/:id/documents — the applicant attaches more
  // documents to their own application while it is still pending: the rest of
  // a submission whose documents do not fit one request, or one sent later.
  // Declared BEFORE `/:id/documents/:documentId/...` only for reading order;
  // the paths do not overlap.
  router.post(
    '/:id/documents',
    documentUpload.array('documents', MAX_DOCUMENT_COUNT),
    handleUploadError,
    requireFilesWithinBudget,
    asyncHandler(applicationController.addApplicationDocuments),
  );

  // GET /api/applications — list my applications (as applicant or ?asLandlord=true)
  router.get('/', asyncHandler(applicationController.listMyApplications));

  // POST /api/applications/:id/documents/:documentId/verification — the
  // landlord's judgement of one document. The ONLY way one reaches `verified`.
  router.post(
    '/:id/documents/:documentId/verification',
    asyncHandler(applicationController.verifyApplicationDocument),
  );

  // GET /api/applications/:id/documents/:documentId — the bytes of ONE attached
  // document, to the applicant or the landlord and nobody else.
  //
  // Declared BEFORE `/:id` so the static `documents` segment is never swallowed
  // by the parameter, the same ordering `routes/leases.ts` and
  // `routes/maintenance.ts` use.
  //
  // On THIS router, which is the authenticated one. That placement is the
  // authorization decision (`AGENTS.md`), and it is the whole point: these
  // documents used to be delivered by `routes/public.ts`.
  router.get(
    '/:id/documents/:documentId',
    asyncHandler(applicationController.getApplicationDocument),
  );

  // GET /api/applications/:id
  router.get('/:id', asyncHandler(applicationController.getApplicationById));

  // PATCH /api/applications/:id — landlord approves/rejects, applicant withdraws
  router.patch(
    '/:id',
    validation.validateTenantApplicationUpdate,
    asyncHandler(applicationController.updateApplicationStatus),
  );

  // POST /api/applications/:id/create-lease — landlord turns an approved
  // application into a draft lease (owner ids resolved server-side).
  router.post('/:id/create-lease', asyncHandler(applicationController.createLeaseFromApplication));

  return router;
}
