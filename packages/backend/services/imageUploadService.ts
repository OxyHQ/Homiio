import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { promises as fs, realpathSync } from 'fs';
import type { Document, Model, Types } from 'mongoose';
import type {
  ImageEntityType,
  ImageVariantKeys,
  ImageVariantName,
  ImageVariantUrls,
} from '@homiio/shared-types';
import config from '../config';
import { validateImageStoreKey } from '../utils/imageStoreKey';

/**
 * Filesystem root of the self-hosted LOCAL image store. Used only when object
 * storage (S3 / Spaces) is NOT configured: processed variant bytes are written
 * here and served back through the backend at `LOCAL_IMAGE_ROUTE/<key>`, so the
 * product renders DB-backed images from our OWN host with zero external image
 * dependency in any storage-less environment (local dev, CI). A credentialed
 * environment uses S3 and never touches this path.
 */
const LOCAL_IMAGE_STORE_DIR = path.join(__dirname, '..', '.local-image-store');

/** Backend route prefix the local image store is served under (no trailing slash). */
export const LOCAL_IMAGE_ROUTE = '/api/images/file';

export interface ImageVariant {
  name: ImageVariantName;
  width: number;
  height: number;
  quality: number;
  format: 'jpeg' | 'webp';
}

export interface UploadedImage {
  original: string;
  variants: Record<string, string>;
  metadata: {
    originalSize: number;
    originalFormat: string;
    uploadedAt: Date;
  };
}

/** Minimal shape of an uploaded file we consume (multer memory-storage entry). */
export interface ImageFileInput {
  mimetype: string;
  buffer: Buffer;
}

/** A raw image buffer plus its declared MIME type (e.g. a remotely fetched photo). */
export interface ImageBufferInput {
  buffer: Buffer;
  mimetype: string;
}

/** Per-image attributes attached when persisting an Image document. */
export interface CreateImageOptions {
  caption?: string;
  isPrimary?: boolean;
  order?: number;
  /** Storage folder prefix; defaults to the `entityType`. */
  folder?: string;
  /**
   * When object storage is NOT configured (no S3 credentials — e.g. a local
   * seed/dev environment), persist the structurally-correct Image document
   * (real Sharp-derived dimensions/format/bytes plus the keys/urls where the
   * bytes WOULD live) WITHOUT performing the upload, instead of throwing.
   *
   * Off by default so request-time upload paths never silently skip storage in
   * production; opt in only from trusted seed scripts.
   */
  allowUnconfiguredStorage?: boolean;
}

/** The persisted Image document shape (mirrors `Image` in shared-types). */
export interface ImageDocument extends Document {
  _id: Types.ObjectId;
  entityType: ImageEntityType;
  entityId: Types.ObjectId;
  keys: ImageVariantKeys;
  urls: ImageVariantUrls;
  width?: number;
  height?: number;
  format: string;
  bytes: number;
  caption?: string;
  isPrimary?: boolean;
  order?: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The four processed variant names, in storage order. */
const VARIANT_NAMES: readonly ImageVariantName[] = ['small', 'medium', 'large', 'original'];

/** Extract a readable message from an unknown thrown value (preserves the cause). */
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A fully processed-and-uploaded image: bucket-relative keys and public URLs for
 * every variant, plus the source dimensions/format/byte size captured once from
 * the original buffer. The intermediate result `createImageForEntity` persists.
 */
interface ProcessedUpload {
  keys: ImageVariantKeys;
  urls: ImageVariantUrls;
  width?: number;
  height?: number;
  format: string;
  bytes: number;
}

export class ImageUploadService {
  private s3Client: S3Client;
  private readonly variants: ImageVariant[] = [
    { name: 'small', width: 300, height: 300, quality: 80, format: 'webp' },
    { name: 'medium', width: 600, height: 600, quality: 85, format: 'webp' },
    { name: 'large', width: 1200, height: 1200, quality: 90, format: 'webp' },
    { name: 'original', width: 0, height: 0, quality: 95, format: 'jpeg' }
  ];

  constructor() {
    // Native AWS S3 when AWS_ENDPOINT_URL is unset; custom endpoint (MinIO /
    // local mocks) only when explicitly configured. forcePathStyle is for
    // S3-compatible stores — never for real AWS (virtual-hosted-style).
    this.s3Client = new S3Client({
      ...(config.s3.endpoint ? { endpoint: config.s3.endpoint, forcePathStyle: true } : {}),
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
  }

  async uploadImage(file: ImageFileInput, folder: string = 'general'): Promise<UploadedImage> {
    try {
      const processed = await this.processAndUpload(file.buffer, file.mimetype, folder);
      return {
        original: processed.keys.original,
        variants: { ...processed.keys },
        metadata: {
          originalSize: processed.bytes,
          originalFormat: processed.format,
          uploadedAt: new Date(),
        },
      };
    } catch (error) {
      throw new Error(`Failed to upload image: ${errorMessage(error)}`);
    }
  }

  /**
   * Process one source image into all four variants, upload each to object
   * storage and return their keys + public URLs together with the source's
   * dimensions, format and original byte size. The single place the Sharp +
   * S3 pipeline runs, shared by {@link uploadImage} and
   * {@link createImageForEntity}.
   */
  private async processAndUpload(
    buffer: Buffer,
    mimetype: string,
    folder: string,
    skipUpload = false
  ): Promise<ProcessedUpload> {
    const imageId = uuidv4();
    const originalFormat = this.getImageFormat(mimetype);

    // Read source dimensions once, up front, so they can be persisted alongside
    // the variants. Sharp's reported format is preferred over the (client-set)
    // MIME type when available.
    const sourceMetadata = await sharp(buffer).metadata();

    const keys: Partial<Record<ImageVariantName, string>> = {};
    let originalBytes = 0;
    // `skipUpload` is now vestigial: when S3 is unconfigured we persist to the
    // self-hosted LOCAL store rather than skipping persistence, so every Image
    // doc — seed or request-time — resolves to real bytes from our own host.
    void skipUpload;

    for (const variant of this.variants) {
      const processedBuffer = await this.processImage(buffer, variant);
      const fileName = this.generateFileName(imageId, variant.name, variant.format);
      const key = `${folder}/${fileName}`;

      // Always process (so dimensions/bytes are real). Persist the bytes to S3
      // when configured; otherwise to the self-hosted local store.
      if (this.isStorageConfigured()) {
        await this.uploadToS3(processedBuffer, key, mimetype);
      } else {
        await this.writeToLocalStore(processedBuffer, key);
      }
      keys[variant.name] = key;

      if (variant.name === 'original') {
        originalBytes = processedBuffer.length;
      }
    }

    const completeKeys = this.assertCompleteVariants(keys);
    const urls = this.variantUrls(completeKeys);

    return {
      keys: completeKeys,
      urls,
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      format: sourceMetadata.format ?? originalFormat,
      bytes: originalBytes,
    };
  }

  /**
   * Whether object storage is configured (S3 access key + secret present). When
   * false, request-time uploads cannot persist bytes; only seed paths that opt
   * in via {@link CreateImageOptions.allowUnconfiguredStorage} proceed (storing
   * the document structure without the upload).
   */
  isStorageConfigured(): boolean {
    return Boolean(config.s3.accessKeyId && config.s3.secretAccessKey);
  }

  /**
   * Process, upload and PERSIST an image for a given entity. Runs the shared
   * Sharp/S3 pipeline, then writes the canonical Image document
   * (`{ entityType, entityId }`-scoped) carrying every variant's key + URL and
   * the source metadata. Returns the saved document.
   *
   * @param entityType - The owning entity kind (property / city / region / …).
   * @param entityId   - The owning entity's `_id`.
   * @param input      - The source image (multer file or raw buffer + mimetype).
   * @param options    - Optional caption / primary flag / order / folder prefix.
   */
  async createImageForEntity(
    entityType: ImageEntityType,
    entityId: Types.ObjectId | string,
    input: ImageFileInput | ImageBufferInput,
    options: CreateImageOptions = {}
  ): Promise<ImageDocument> {
    const folder = options.folder ?? entityType;
    // Skip the upload only when storage is unconfigured AND the caller explicitly
    // allows it (seed path). Otherwise upload normally — and if storage is
    // unconfigured without opt-in, the S3 PUT throws a clear, non-silent error.
    const skipUpload = options.allowUnconfiguredStorage === true && !this.isStorageConfigured();
    const processed = await this.processAndUpload(input.buffer, input.mimetype, folder, skipUpload);

    // Resolve the model lazily to avoid a module-load cycle (models/index pulls
    // in schemas which may import services), and to reuse the single registration.
    const ImageModel = require('../models').Image as Model<ImageDocument>;

    const created = await ImageModel.create({
      entityType,
      entityId,
      keys: processed.keys,
      urls: processed.urls,
      width: processed.width,
      height: processed.height,
      format: processed.format,
      bytes: processed.bytes,
      caption: options.caption,
      isPrimary: options.isPrimary ?? false,
      order: options.order ?? 0,
    });

    return created;
  }

  /** Public-URL map for a complete set of variant keys. */
  private variantUrls(keys: ImageVariantKeys): ImageVariantUrls {
    return {
      original: this.getImageUrl(keys.original),
      small: this.getImageUrl(keys.small),
      medium: this.getImageUrl(keys.medium),
      large: this.getImageUrl(keys.large),
    };
  }

  /**
   * Assert every variant key was produced (the loop covers all four
   * {@link VARIANT_NAMES}); narrows `Partial<…>` to a complete
   * {@link ImageVariantKeys} without a non-null assertion.
   */
  private assertCompleteVariants(
    keys: Partial<Record<ImageVariantName, string>>
  ): ImageVariantKeys {
    const missing = VARIANT_NAMES.filter((name) => keys[name] === undefined);
    if (missing.length > 0) {
      throw new Error(`Image processing did not produce variants: ${missing.join(', ')}`);
    }
    return {
      original: keys.original ?? '',
      small: keys.small ?? '',
      medium: keys.medium ?? '',
      large: keys.large ?? '',
    };
  }

  async deleteImage(imageKey: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: config.s3.bucketName,
        Key: imageKey,
      });
      
      await this.s3Client.send(command);
    } catch (error) {
      throw new Error(`Failed to delete image: ${errorMessage(error)}`);
    }
  }

  async deleteImageVariants(imageKeys: string[]): Promise<void> {
    try {
      const deletePromises = imageKeys.map(key => this.deleteImage(key));
      await Promise.all(deletePromises);
    } catch (error) {
      throw new Error(`Failed to delete image variants: ${errorMessage(error)}`);
    }
  }

  private async processImage(buffer: Buffer, variant: ImageVariant): Promise<Buffer> {
    let sharpInstance = sharp(buffer);

    // Resize if dimensions are specified
    if (variant.width > 0 && variant.height > 0) {
      sharpInstance = sharpInstance.resize(variant.width, variant.height, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Apply format and quality
    if (variant.format === 'webp') {
      return await sharpInstance
        .webp({ quality: variant.quality })
        .toBuffer();
    } else {
      return await sharpInstance
        .jpeg({ quality: variant.quality })
        .toBuffer();
    }
  }

  private async uploadToS3(buffer: Buffer, key: string, contentType: string): Promise<void> {
    // Homiio media buckets use BucketOwnerEnforced (ACLs disabled). Do not set
    // ACL — public delivery is via signed URL / CDN, not object ACLs.
    const command = new PutObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000', // 1 year cache
    });

    await this.s3Client.send(command);
  }

  private generateFileName(imageId: string, variant: string, format: string): string {
    return `${imageId}-${variant}.${format}`;
  }

  private getImageFormat(mimeType: string): string {
    const formatMap: Record<string, string> = {
      'image/jpeg': 'jpeg',
      'image/jpg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    
    return formatMap[mimeType] || 'jpeg';
  }

  getImageUrl(key: string): string {
    // Self-hosted local store when S3 is unconfigured: serve through the backend
    // so the URL is genuinely reachable (and the product has no external image
    // host). Otherwise build the object-storage public URL.
    if (!this.isStorageConfigured()) {
      return `${config.publicUrl}${LOCAL_IMAGE_ROUTE}/${key}`;
    }
    if (config.s3.endpoint) {
      return `${config.s3.endpoint.replace(/\/$/, '')}/${config.s3.bucketName}/${key}`;
    }
    // Native AWS virtual-hosted-style URL.
    return `https://${config.s3.bucketName}.s3.${config.s3.region}.amazonaws.com/${key}`;
  }

  /**
   * Persist a processed variant's bytes to the self-hosted local store at
   * `LOCAL_IMAGE_STORE_DIR/<key>` (creating parent folders as needed). The key
   * is already a safe, server-generated `<folder>/<uuid>-<variant>.<ext>`.
   */
  private async writeToLocalStore(buffer: Buffer, key: string): Promise<void> {
    const target = path.join(LOCAL_IMAGE_STORE_DIR, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
  }

  /**
   * Read a stored image's bytes + content type from the self-hosted local store
   * for a bucket-relative `key`, or `null` when the file is absent or the key is
   * not safe to read. This is the SECOND, independent path-traversal gate (the
   * serve controller validates first); it must hold on its own even if the
   * controller's check were bypassed or a future caller passed an unchecked key:
   *
   *  1. Re-run the same string validation (reject `..`, absolute, backslash, NUL,
   *     drive/UNC, and non-image extensions). A rejected key reads nothing.
   *  2. Resolve the key under the store root and verify the REAL (fully
   *     symlink-resolved) target path — leaf component included — still lives
   *     inside the real store root, so a symlink planted inside the store cannot
   *     redirect the read outside it.
   *
   * Returns `null` (never throws to the caller, never leaks a path) for any
   * unsafe key, containment failure, or missing file; genuine read errors are
   * surfaced. The content type is derived from the validated extension.
   */
  async readLocalImage(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const validation = validateImageStoreKey(key);
    if (!validation.ok) {
      return null;
    }

    const root = path.resolve(LOCAL_IMAGE_STORE_DIR);
    const resolved = path.resolve(root, validation.key);

    // String-level containment on the resolved (lexical) path.
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return null;
    }

    // Realpath containment: resolve every symlink — on the store root AND on the
    // FULL target path (its leaf component included) — then require the canonical
    // target to still live under the canonical root. Resolving the whole target
    // (not just its parent directory) is essential: the leaf itself may be a
    // symlink (e.g. `city/x.webp -> /etc/passwd`) that `path.join` would not
    // resolve, so `fs.readFile` would otherwise follow it out of the store.
    //
    // `realpathSync` throws ENOENT/ENOTDIR for a path that does not exist, which
    // simply means "no such image" → null (no leak of the attempted path).
    let realRoot: string;
    let realTarget: string;
    try {
      realRoot = realpathSync(root);
      realTarget = realpathSync(resolved);
    } catch (error) {
      if (this.isFileMissingError(error)) {
        return null;
      }
      throw error;
    }
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      return null;
    }

    try {
      const buffer = await fs.readFile(realTarget);
      return { buffer, contentType: validation.contentType };
    } catch (error) {
      if (this.isFileMissingError(error)) {
        return null;
      }
      throw error;
    }
  }

  /** Whether a filesystem error means the path simply does not exist. */
  private isFileMissingError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const code = (error as { code?: string }).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }

  getAllImageUrls(uploadedImage: UploadedImage): Record<string, string> {
    const urls: Record<string, string> = {};
    
    urls.original = this.getImageUrl(uploadedImage.original);
    
    for (const [variant, key] of Object.entries(uploadedImage.variants)) {
      urls[variant] = this.getImageUrl(key);
    }
    
    return urls;
  }
}

export default new ImageUploadService();
