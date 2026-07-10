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

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif'
]);

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_DOCUMENT_COUNT = 10;

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_BYTES,
    files: MAX_DOCUMENT_COUNT
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and common image formats are allowed.'));
    }
  }
});

export default function () {
  const router = express.Router();

  const applicationController = require('../controllers/applicationController');
  const validation = require('../middlewares/validation');

  // POST /api/applications — applicant submits long-term application
  // Accepts either application/json or multipart/form-data with `documents[]` files.
  router.post(
    '/',
    documentUpload.array('documents', MAX_DOCUMENT_COUNT),
    handleUploadError,
    validation.validateTenantApplication,
    asyncHandler(applicationController.createApplication)
  );

  // GET /api/applications — list my applications (as applicant or ?asLandlord=true)
  router.get(
    '/',
    asyncHandler(applicationController.listMyApplications)
  );

  // GET /api/applications/:id
  router.get(
    '/:id',
    asyncHandler(applicationController.getApplicationById)
  );

  // PATCH /api/applications/:id — landlord approves/rejects, applicant withdraws
  router.patch(
    '/:id',
    validation.validateTenantApplicationUpdate,
    asyncHandler(applicationController.updateApplicationStatus)
  );

  // POST /api/applications/:id/create-lease — landlord turns an approved
  // application into a draft lease (owner ids resolved server-side).
  router.post(
    '/:id/create-lease',
    asyncHandler(applicationController.createLeaseFromApplication)
  );

  return router;
}
