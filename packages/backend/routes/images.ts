import { Router, Request } from 'express';
import multer from 'multer';
import imageController from '../controllers/imageController';
import handleUploadError from '../middlewares/uploadMiddleware';

const router = Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter to only allow images
const fileFilter = (req: Request, file: any, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
  }
};

// Configure multer upload with debugging
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 10, // Maximum 10 files for multiple upload
  },
});

// Alternative simpler upload configuration for debugging
const simpleUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
});

// Test multer configuration
const testUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
});

// Debug middleware (no-op)
const debugMulter = (req: any, res: any, next: any) => {
  next();
};

const debugAfterMulter = (req: any, res: any, next: any) => {
  next();
};

// Single image upload
router.post('/upload', upload.single('image'), handleUploadError, imageController.uploadImage);

// Multiple images upload
router.post('/upload-multiple', debugMulter, testUpload.array('images', 10), debugAfterMulter, handleUploadError, imageController.uploadMultipleImages);

// Delete single image
router.delete('/:imageKey', imageController.deleteImage);

// Delete multiple image variants
router.delete('/variants', imageController.deleteImageVariants);

// Get image info
router.get('/info/:imageKey', imageController.getImageInfo);

// Test endpoint to verify route is mounted
router.get('/test', (req, res) => {
  res.json({ message: 'Images route is working', timestamp: new Date().toISOString() });
});

module.exports = router;
