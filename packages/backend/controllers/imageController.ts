/**
 * `/api/images/*` — a person's photo uploads, and the legacy photo door.
 *
 * ## Uploads go to the uploader's own Oxy account (ADR 0043)
 *
 * `POST /api/images/upload` and `/upload-multiple` store each photo in the
 * signed-in person's Oxy Files, as THEIR public file
 * (`services/files/publicImages.uploadAccountImage`, which strips the EXIF on
 * the way). Nothing is written to Homiio's storage and no `images` row is made
 * yet: the row is minted when the photo is published on a listing or a case,
 * after Oxy confirms the file is this person's own
 * (`requireOwnAccountImages`). Until then it is simply a file in their account;
 * if they never publish it, Oxy shows it to them as "not in use" — it is never
 * deleted behind their back.
 *
 * The answer keeps the shape every app build already reads — `imageId`,
 * `urls`, `metadata`, `keys` — and adds `fileId`. `keys` carries
 * `oxy:<fileId>`, so a build that publishes `keys` publishes the right file.
 *
 * ## What was removed, and why
 *
 * - Uploads that named an `entityType`/`entityId` made an `images` row for ANY
 *   entity — a city, a country — from any signed-in account, and nothing ever
 *   showed it. No client sends them; the fields are ignored.
 * - `DELETE /api/images/:imageKey` deleted ANY bucket object by key for any
 *   signed-in account. It now deletes nothing and answers 200, because an app
 *   build already in people's hands calls it when a photo is removed from the
 *   picker: the photo is the person's own file in Oxy, to keep or delete there.
 * - `DELETE /api/images/variants` and `GET /api/images/info/:imageKey` had no
 *   caller.
 */

import type { Request, Response } from 'express';
import { IMAGE_UPLOAD_MAX_FILE_BYTES } from '@homiio/shared-types';
import { requireSessionOxyUserId } from '../utils/sessionUser';
import { AppError, logUnexpectedError } from '../middlewares/errorHandler';
import { fileIdFromOxyKey, OXY_KEY_PREFIX, oxyImageUrls } from '../services/files/imageUrls';
import { resolveLegacyImage } from '../services/files/legacyImages';
import { oxyErrorCode, oxyErrorStatus } from '../services/files/oxyFilesClient';
import { type StoredPublicImage, uploadAccountImage } from '../services/files/publicImages';

// Minimal shape for an uploaded file to avoid relying on Express.Multer types
type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

/** Image MIME types the upload endpoints accept. */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

/** Maximum accepted upload size (bytes). The multer route limit, and the app's. */
const MAX_UPLOAD_BYTES = IMAGE_UPLOAD_MAX_FILE_BYTES;

/** Validate a single file's MIME type + size; returns an error message or null. */
function validateFile(file: {
  mimetype: string;
  size: number;
  originalname?: string;
}): string | null {
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

/** The upload answer every app build reads, for one stored photo. */
function uploadAnswer(image: StoredPublicImage) {
  const key = `${OXY_KEY_PREFIX}${image.fileId}`;
  return {
    imageId: image.fileId,
    fileId: image.fileId,
    urls: oxyImageUrls(image.fileId),
    metadata: {
      originalSize: image.bytes,
      originalFormat: image.format,
      uploadedAt: new Date(),
      ...(image.width === undefined ? {} : { width: image.width }),
      ...(image.height === undefined ? {} : { height: image.height }),
    },
    keys: {
      original: key,
      variants: { original: key, small: key, medium: key, large: key },
    },
  };
}

/**
 * The status an Oxy refusal is answered with. A photo Oxy refused for what it
 * IS (too large, not an image, bytes taken down after a rights claim — 451)
 * is the uploader's to know about; anything else is Homiio's problem (502).
 */
function refusal(error: unknown): { status: number; message: string } | null {
  // Homiio's own refusals (no session) answer as themselves.
  if (error instanceof AppError) return { status: error.statusCode, message: error.message };
  const status = oxyErrorStatus(error);
  if (status === 413) return { status: 413, message: 'File size too large.' };
  if (status === 415) return { status: 400, message: 'Invalid file type.' };
  if (status === 451) {
    return {
      status: 451,
      message: 'This photo was removed after a legal claim and cannot be uploaded again.',
    };
  }
  if (oxyErrorCode(error) === 'STORAGE_QUOTA_EXCEEDED') {
    return { status: 413, message: 'Your Oxy storage is full.' };
  }
  return null;
}

export class ImageController {
  async uploadImage(req: Request, res: Response): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No image file provided' });
        return;
      }
      const validationError = validateFile(req.file);
      if (validationError) {
        res.status(400).json({ success: false, message: validationError });
        return;
      }
      const stored = await uploadAccountImage(oxyUserId, {
        buffer: req.file.buffer,
        originalName: req.file.originalname,
      });
      res.status(200).json({
        success: true,
        message: 'Image uploaded successfully',
        data: uploadAnswer(stored),
      });
    } catch (error) {
      const known = refusal(error);
      if (known) {
        res.status(known.status).json({ success: false, message: known.message });
        return;
      }
      logUnexpectedError(error, req, 'Failed to upload image');
      res.status(502).json({
        success: false,
        message: 'Failed to upload image',
        error: 'Upstream storage error',
      });
    }
  }

  async uploadMultipleImages(req: Request, res: Response): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
        res.status(400).json({ success: false, message: 'No image files provided' });
        return;
      }
      // Normalize req.files, which is an array or a field map depending on multer usage.
      const files: UploadedFile[] = Array.isArray(req.files)
        ? (req.files as unknown as UploadedFile[])
        : (Object.values(req.files as Record<string, UploadedFile[]>)
            .flat()
            .filter(Boolean) as UploadedFile[]);

      // Validate every file before storing any of them.
      for (const file of files) {
        const validationError = validateFile(file);
        if (validationError) {
          res.status(400).json({ success: false, message: validationError });
          return;
        }
      }

      const uploaded = [];
      for (const file of files) {
        const stored = await uploadAccountImage(oxyUserId, {
          buffer: file.buffer,
          originalName: file.originalname,
        });
        uploaded.push({ originalName: file.originalname, ...uploadAnswer(stored) });
      }

      res.status(200).json({
        success: true,
        message: `Successfully uploaded ${uploaded.length} images`,
        data: { uploadedCount: uploaded.length, images: uploaded },
      });
    } catch (error) {
      const known = refusal(error);
      if (known) {
        res.status(known.status).json({ success: false, message: known.message });
        return;
      }
      logUnexpectedError(error, req, 'Failed to upload images');
      res.status(502).json({
        success: false,
        message: 'Failed to upload images',
        error: 'Upstream storage error',
      });
    }
  }

  /**
   * Removing a photo from the picker. Deletes nothing — see the module header
   * — and answers the shape an app build already in use expects.
   */
  async forgetUpload(req: Request, res: Response): Promise<void> {
    const { imageKey } = req.params;
    if (!imageKey) {
      res.status(400).json({ success: false, message: 'Image key is required' });
      return;
    }
    res.status(200).json({
      success: true,
      message: fileIdFromOxyKey(imageKey)
        ? 'Image removed; the file stays in your Oxy account'
        : 'Image removed',
    });
  }

  /**
   * `GET /api/images/file/*` — the legacy door (`services/files/legacyImages`).
   *
   * The key is the wildcard tail, already URL-decoded by Express, and is
   * untrusted: `validateImageStoreKey` refuses traversal, absolute paths,
   * private prefixes and non-image extensions before anything is looked up.
   * A missing photo is a flat 404 that says nothing about why.
   */
  async serveLegacyImage(req: Request, res: Response): Promise<void> {
    try {
      const rawKey = req.params[0];
      if (typeof rawKey !== 'string' || rawKey.length === 0) {
        res.status(400).json({ success: false, message: 'Image key is required' });
        return;
      }
      const answer = await resolveLegacyImage(rawKey);
      switch (answer.kind) {
        case 'invalid':
          res.status(400).json({ success: false, message: 'Invalid image key' });
          return;
        case 'missing':
          res.status(404).json({ success: false, message: 'Image not found' });
          return;
        case 'redirect':
          // Permanent: the photo lives in Oxy now, and a browser that
          // remembers that never asks this door again.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.redirect(301, answer.location);
          return;
      }
    } catch (error) {
      logUnexpectedError(error, req, 'Failed to serve image');
      res.status(500).json({
        success: false,
        message: 'Failed to serve image',
        error: 'Internal server error',
      });
    }
  }
}

export default new ImageController();
