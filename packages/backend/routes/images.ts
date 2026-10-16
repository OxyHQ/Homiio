import { Router, type Request } from 'express';
import multer from 'multer';
import imageController from '../controllers/imageController';
import handleUploadError from '../middlewares/uploadMiddleware';

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
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10,
  },
});

router.post('/upload', upload.single('image'), handleUploadError, imageController.uploadImage);

router.post(
  '/upload-multiple',
  upload.array('images', 10),
  handleUploadError,
  imageController.uploadMultipleImages,
);

// Removing a photo from the picker. Deletes nothing (see the controller).
router.delete('/:imageKey', imageController.forgetUpload);

export default router;
