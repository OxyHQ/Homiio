import { Router, type Request } from 'express';
import multer from 'multer';
import {
  IMAGE_UPLOAD_MAX_FILE_BYTES,
  IMAGE_UPLOAD_MAX_FILES_PER_REQUEST,
} from '@homiio/shared-types';
import imageController from '../controllers/imageController';
import handleUploadError from '../middlewares/uploadMiddleware';
import { requireFilesWithinBudget } from '../middlewares/uploadBudget';

/**
 * `/api/images` (authenticated): a person's photo uploads into their own Oxy
 * account. The legacy delivery door `GET /api/images/file/*` is on the PUBLIC
 * router. `controllers/imageController.ts` says what was removed and why.
 */
const router = Router();

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
    }
  },
  // Per file and per request. Ten 10 MB photos are 100 MB — over the request
  // budget — so the app plans its requests with `planUploadBatches` and the
  // total is checked after multer (`middlewares/uploadBudget.ts`).
  limits: {
    fileSize: IMAGE_UPLOAD_MAX_FILE_BYTES,
    files: IMAGE_UPLOAD_MAX_FILES_PER_REQUEST,
    fields: 32,
  },
});

router.post('/upload', upload.single('image'), handleUploadError, imageController.uploadImage);

router.post(
  '/upload-multiple',
  upload.array('images', IMAGE_UPLOAD_MAX_FILES_PER_REQUEST),
  handleUploadError,
  requireFilesWithinBudget,
  imageController.uploadMultipleImages,
);

// Removing a photo from the picker. Deletes nothing (see the controller).
router.delete('/:imageKey', imageController.forgetUpload);

export default router;
