import { Request, Response } from 'express';
import { Types } from 'mongoose';
import type { ImageEntityType } from '@homiio/shared-types';
import imageUploadService, {
  UploadedImage,
  ImageDocument,
} from '../services/imageUploadService';
import { validateImageStoreKey } from '../utils/imageStoreKey';

// Minimal shape for an uploaded file to avoid relying on Express.Multer types
type UploadedFile = {
  fieldname?: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

/** Image MIME types the upload endpoints accept. */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

/** Maximum accepted upload size (bytes). Mirrors the multer route limit. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

/** Entity kinds an uploaded image may be attached to. */
const IMAGE_ENTITY_TYPES: readonly ImageEntityType[] = [
  'property',
  'city',
  'region',
  'country',
  'profile',
];

/** A resolved `{ entityType, entityId }` target, or a reason it could not resolve. */
type EntityTarget =
  | { kind: 'none' }
  | { kind: 'invalid'; message: string }
  | { kind: 'resolved'; entityType: ImageEntityType; entityId: Types.ObjectId };

/**
 * Resolve the optional `entityType` + `entityId` an upload should be attached to
 * from the request body. Absent entity info is valid (a generic upload, e.g. a
 * draft photo before its property exists) — `{ kind: 'none' }`. A partial or
 * malformed pair is rejected so a typo never silently produces an orphan upload.
 */
function resolveEntityTarget(body: Record<string, unknown>): EntityTarget {
  const rawType = body.entityType;
  const rawId = body.entityId;

  if (rawType === undefined && rawId === undefined) {
    return { kind: 'none' };
  }
  if (typeof rawType !== 'string' || !IMAGE_ENTITY_TYPES.includes(rawType as ImageEntityType)) {
    return {
      kind: 'invalid',
      message: `entityType must be one of: ${IMAGE_ENTITY_TYPES.join(', ')}`,
    };
  }
  if (typeof rawId !== 'string' || !Types.ObjectId.isValid(rawId)) {
    return { kind: 'invalid', message: 'entityId must be a valid id' };
  }
  return {
    kind: 'resolved',
    entityType: rawType as ImageEntityType,
    entityId: new Types.ObjectId(rawId),
  };
}

/** A non-negative integer parsed from a request body field, or undefined. */
function parseOrder(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Validate a single file's MIME type + size; returns an error message or null. */
function validateFile(file: { mimetype: string; size: number; originalname?: string }): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    const suffix = file.originalname ? ` for ${file.originalname}` : '';
    return `Invalid file type${suffix}. Only JPEG, PNG, WebP, and GIF are allowed.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const suffix = file.originalname ? ` for ${file.originalname}` : '';
    return `File size too large${suffix}. Maximum size is 10MB.`;
  }
  return null;
}

/** Whether a parsed body flag is truthy (`true` / `"true"`). */
function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

export class ImageController {
  async uploadImage(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No image file provided' });
        return;
      }

      const validationError = validateFile(req.file);
      if (validationError) {
        res.status(400).json({ success: false, message: validationError });
        return;
      }

      const target = resolveEntityTarget(req.body);
      if (target.kind === 'invalid') {
        res.status(400).json({ success: false, message: target.message });
        return;
      }

      const folder = typeof req.body.folder === 'string' ? req.body.folder : 'general';
      const uploadedImage: UploadedImage = await imageUploadService.uploadImage(req.file, folder);
      const imageUrls = imageUploadService.getAllImageUrls(uploadedImage);

      // When the upload targets a known entity, persist the canonical Image doc
      // (re-running the pipeline once via the service so keys/variants/metadata
      // are stored, not discarded). The response keeps its existing shape and
      // gains the persisted document id.
      let persisted: ImageDocument | null = null;
      if (target.kind === 'resolved') {
        persisted = await imageUploadService.createImageForEntity(
          target.entityType,
          target.entityId,
          req.file,
          {
            caption: typeof req.body.caption === 'string' ? req.body.caption : undefined,
            isPrimary: isTrue(req.body.isPrimary),
            order: parseOrder(req.body.order),
            folder,
          }
        );
      }

      res.status(200).json({
        success: true,
        message: 'Image uploaded successfully',
        data: {
          imageId: uploadedImage.original.split('/').pop()?.split('-')[0],
          imageDocId: persisted ? String(persisted._id) : undefined,
          urls: imageUrls,
          metadata: uploadedImage.metadata,
          keys: {
            original: uploadedImage.original,
            variants: uploadedImage.variants,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to upload image',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async uploadMultipleImages(req: Request, res: Response): Promise<void> {
    try {
      if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
        res.status(400).json({ success: false, message: 'No image files provided' });
        return;
      }

      // Normalize req.files which can be an array or a field map depending on multer usage
      const files: UploadedFile[] = Array.isArray(req.files)
        ? (req.files as unknown as UploadedFile[])
        : (Object.values(req.files as Record<string, UploadedFile[]>).flat().filter(Boolean) as UploadedFile[]);

      const folder = typeof req.body.folder === 'string' ? req.body.folder : 'general';

      const target = resolveEntityTarget(req.body);
      if (target.kind === 'invalid') {
        res.status(400).json({ success: false, message: target.message });
        return;
      }

      // Validate every file before uploading any of them.
      for (const file of files) {
        const validationError = validateFile(file);
        if (validationError) {
          res.status(400).json({ success: false, message: validationError });
          return;
        }
      }

      const uploadedImages: Array<{
        originalName: string;
        imageId: string | undefined;
        imageDocId?: string;
        urls: Record<string, string>;
        metadata: UploadedImage['metadata'];
        keys: { original: string; variants: Record<string, string> };
      }> = [];

      // Upload each image; when targeting an entity, persist an ordered Image doc.
      let nextOrder = parseOrder(req.body.order) ?? 0;
      for (const file of files) {
        try {
          const uploadedImage = await imageUploadService.uploadImage(file, folder);
          const imageUrls = imageUploadService.getAllImageUrls(uploadedImage);

          let persisted: ImageDocument | null = null;
          if (target.kind === 'resolved') {
            persisted = await imageUploadService.createImageForEntity(
              target.entityType,
              target.entityId,
              file,
              {
                isPrimary: nextOrder === 0 && isTrue(req.body.isPrimary),
                order: nextOrder,
                folder,
              }
            );
            nextOrder += 1;
          }

          uploadedImages.push({
            originalName: file.originalname,
            imageId: uploadedImage.original.split('/').pop()?.split('-')[0],
            imageDocId: persisted ? String(persisted._id) : undefined,
            urls: imageUrls,
            metadata: uploadedImage.metadata,
            keys: { original: uploadedImage.original, variants: uploadedImage.variants },
          });
        } catch (error) {
          // One bad file should not fail the batch; record nothing for it and
          // continue. A genuine systemic failure surfaces on every file.
          const message = error instanceof Error ? error.message : 'Unknown error';
          throw new Error(`Failed to process ${file.originalname}: ${message}`);
        }
      }

      res.status(200).json({
        success: true,
        message: `Successfully uploaded ${uploadedImages.length} images`,
        data: { uploadedCount: uploadedImages.length, images: uploadedImages },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to upload images',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async deleteImage(req: Request, res: Response): Promise<void> {
    try {
      const { imageKey } = req.params;
      if (!imageKey) {
        res.status(400).json({ success: false, message: 'Image key is required' });
        return;
      }

      await imageUploadService.deleteImage(imageKey);

      res.status(200).json({ success: true, message: 'Image deleted successfully' });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete image',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async deleteImageVariants(req: Request, res: Response): Promise<void> {
    try {
      const { imageKeys } = req.body;
      if (!imageKeys || !Array.isArray(imageKeys) || imageKeys.length === 0) {
        res.status(400).json({ success: false, message: 'Image keys array is required' });
        return;
      }

      await imageUploadService.deleteImageVariants(imageKeys);

      res.status(200).json({ success: true, message: 'Image variants deleted successfully' });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete image variants',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Serve a processed image's bytes from the self-hosted LOCAL store (used when
   * object storage is not configured). The bucket-relative key is the wildcard
   * tail of the route (`GET /api/images/file/*`), which Express delivers already
   * URL-decoded — so `..%2f..` arrives as `../..`. The key is UNTRUSTED input and
   * is the FIRST of two independent path-traversal gates:
   *
   *  1. (here) validate the key by string analysis — reject `..`, absolute paths,
   *     backslashes, NUL bytes, drive/UNC prefixes, and any non-image extension —
   *     before it can reach the filesystem; serve only allowlisted image types.
   *  2. ({@link ImageUploadService.readLocalImage}) re-resolve under the store
   *     root with realpath containment, so a bypass of this gate still cannot
   *     escape the store.
   *
   * Filesystem errors are never surfaced: a missing/forbidden file is a flat 404
   * so the route leaks neither paths nor existence of out-of-store files.
   */
  async serveLocalImage(req: Request, res: Response): Promise<void> {
    try {
      const rawKey = req.params[0];
      if (typeof rawKey !== 'string' || rawKey.length === 0) {
        res.status(400).json({ success: false, message: 'Image key is required' });
        return;
      }

      const validation = validateImageStoreKey(rawKey);
      if (!validation.ok) {
        res.status(400).json({ success: false, message: 'Invalid image key' });
        return;
      }

      const file = await imageUploadService.readStoredImage(validation.key);
      if (!file) {
        res.status(404).json({ success: false, message: 'Image not found' });
        return;
      }

      // Trust the extension-derived content type from the (allowlisted) key over
      // whatever the store reports, so the response can only be an image type.
      res.setHeader('Content-Type', validation.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).end(file.buffer);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to serve image',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async getImageInfo(req: Request, res: Response): Promise<void> {
    try {
      const { imageKey } = req.params;
      if (!imageKey) {
        res.status(400).json({ success: false, message: 'Image key is required' });
        return;
      }

      const imageUrl = imageUploadService.getImageUrl(imageKey);

      res.status(200).json({ success: true, data: { key: imageKey, url: imageUrl } });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get image info',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

export default new ImageController();
