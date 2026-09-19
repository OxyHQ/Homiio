/**
 * `/api/maintenance` — repair requests (#518 §7.1, #519 §7.1).
 *
 * Mounted on `routes/index.ts`, which is the authenticated router: every
 * handler here needs a session, and `AGENTS.md` is explicit that the ROUTER is
 * what decides that rather than a per-handler check. There is deliberately no
 * public read — a repair request names a household's problems in a building
 * somebody can find.
 *
 * Static segments are declared before the `/:id` matcher so `comments` and
 * `status` are never swallowed by it — the same ordering `routes/leases.ts`
 * uses, for the same reason.
 */

import express from 'express';
import multer from 'multer';

import * as maintenanceController from '../controllers/maintenanceController';
import { asyncHandler } from '../middlewares';
import handleUploadError from '../middlewares/uploadMiddleware';

/**
 * Photos only, and small ones.
 *
 * The type allowlist is what the re-encoder can actually decode; a PDF or a
 * video accepted here would fail inside Sharp with an error describing the
 * wrong problem. 8 MB is a phone photo with room to spare, and the count limit
 * is ONE — each upload is its own request, so a partial failure loses one photo
 * rather than the batch, and the per-request ceiling is enforced against the
 * rows that already exist rather than against this form.
 */
const ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only photos can be attached to a repair request.'));
  },
});

export default function () {
  const router = express.Router();

  router.get('/', asyncHandler(maintenanceController.listRequests));
  router.post('/', asyncHandler(maintenanceController.createRequest));

  router.post('/:id/status', asyncHandler(maintenanceController.transitionRequest));
  router.post('/:id/comments', asyncHandler(maintenanceController.commentOnRequest));
  router.post(
    '/:id/attachments',
    attachmentUpload.single('photo'),
    handleUploadError,
    asyncHandler(maintenanceController.attachToRequest),
  );
  router.get(
    '/:id/attachments/:attachmentId',
    asyncHandler(maintenanceController.getRequestAttachment),
  );

  router.get('/:id', asyncHandler(maintenanceController.getRequest));

  return router;
}
