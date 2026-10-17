/**
 * Homiio's OWN bucket — the storage Homiio is leaving (ADR 0043 stage 4).
 *
 * Since the move to Oxy Files nothing PUBLIC is written here. Three things
 * still touch it, and each has a named end:
 *
 * 1. **Reads of photos not yet migrated**, through the legacy route
 *    (`legacyImages.ts`), counted in `legacy_media_reads`. Ends when
 *    `scripts/migrateImagesToOxy.ts` has copied every used row and the counter
 *    has read zero `served` for the soak (`docs/oxy-files.md`).
 * 2. **Private documents** — lease documents, application documents,
 *    maintenance photos — through `privateDocuments.ts`: those stored before
 *    the move, and new ones while `OXY_PRIVATE_DOCUMENTS_ENABLED` is off or
 *    Oxy refuses one. Ends when `scripts/migratePrivateDocumentsToOxy.ts` has
 *    moved every row into its owner's Oxy account (ADR 0043 stage 4c).
 * 3. **The migration scripts**, reading each object once to copy it.
 *
 * ## There is no local-disk fallback any more
 *
 * Without object storage this used to write variants under
 * `.local-image-store/` and serve them back from the same route — a second,
 * silent storage that production never had and every test exercised. A
 * deployment without the bucket now gets {@link ObjectStoreUnavailableError}
 * from a private-document upload (answered 503) and a 404 from a legacy read,
 * and the test suite installs {@link MemoryObjectStore} explicitly
 * (`jest.setupWorkerDatabase.cjs` sets `HOMIIO_OBJECT_STORE=memory`), so what
 * a test proves is the contract of a store, not the behaviour of a directory.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import config from '../../config';
import { describeErrorForLog } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';

/** One stored object's bytes and type. */
export interface StoredObject {
  buffer: Buffer;
  contentType: string;
}

/** The three things anything still does with the bucket. */
export interface LegacyObjectStore {
  /** Whether a bucket is configured at all. */
  readonly configured: boolean;
  get(key: string): Promise<StoredObject | null>;
  /** Private writes only — see the module header. */
  putPrivate(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** There is no bucket in this deployment. */
export class ObjectStoreUnavailableError extends Error {
  constructor() {
    super('Object storage is not configured (AWS_S3_BUCKET)');
    this.name = 'ObjectStoreUnavailableError';
  }
}

/**
 * Whether an S3 error means "no such object".
 *
 * `AccessDenied`/403 counts: without `s3:ListBucket` — which the task role
 * does not have and should not — S3 answers a missing key with 403 so a
 * stranger cannot probe which keys exist. The caller logs it, so a genuinely
 * broken bucket policy stays visible in the logs while the wire answers 404.
 */
export function isMissingObjectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: string }).name;
  if (name === 'NoSuchKey' || name === 'NotFound' || name === 'AccessDenied') return true;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return status === 404 || status === 403;
}

export class S3LegacyObjectStore implements LegacyObjectStore {
  readonly configured = true;
  private readonly client: S3Client;

  constructor(private readonly bucket: string) {
    // Native AWS S3 when AWS_ENDPOINT_URL is unset; a custom endpoint (MinIO)
    // only when explicitly configured, and path-style only then.
    this.client = new S3Client({
      ...(config.s3.endpoint ? { endpoint: config.s3.endpoint, forcePathStyle: true } : {}),
      region: config.s3.region,
      ...(config.s3.accessKeyId && config.s3.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.s3.accessKeyId,
              secretAccessKey: config.s3.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) return null;
      const buffer = Buffer.from(await response.Body.transformToByteArray());
      return { buffer, contentType: response.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      if (isMissingObjectError(error)) {
        logger.warn('Stored object could not be read; answering as missing', {
          store: 's3',
          reason: describeErrorForLog(error),
        });
        return null;
      }
      throw error;
    }
  }

  async putPrivate(key: string, body: Buffer, contentType: string): Promise<void> {
    // `private, no-store`: a tenancy's evidence must not sit in a proxy cache.
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'private, no-store',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** An in-process store: the test suite's, never a production fallback. */
export class MemoryObjectStore implements LegacyObjectStore {
  readonly configured = true;
  readonly objects = new Map<string, StoredObject>();

  async get(key: string): Promise<StoredObject | null> {
    const found = this.objects.get(key);
    return found ? { buffer: Buffer.from(found.buffer), contentType: found.contentType } : null;
  }

  async putPrivate(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { buffer: Buffer.from(body), contentType });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** No bucket: every read is missing and every write refuses. */
class UnconfiguredObjectStore implements LegacyObjectStore {
  readonly configured = false;

  async get(): Promise<StoredObject | null> {
    return null;
  }

  async putPrivate(): Promise<void> {
    throw new ObjectStoreUnavailableError();
  }

  async delete(): Promise<void> {
    throw new ObjectStoreUnavailableError();
  }
}

/**
 * Whether a bucket is configured: static keys plus a bucket, or (on ECS) the
 * task role with an explicit `AWS_S3_BUCKET` — the config default bucket name
 * alone is a development placeholder, not a bucket.
 */
function bucketConfigured(): boolean {
  const { accessKeyId, secretAccessKey } = config.s3;
  if (accessKeyId && secretAccessKey) return true;
  return !accessKeyId && !secretAccessKey && Boolean(process.env.AWS_S3_BUCKET);
}

let store: LegacyObjectStore | null = null;

/** The bucket, chosen once per process. */
export function legacyObjectStore(): LegacyObjectStore {
  if (store) return store;
  if (process.env.HOMIIO_OBJECT_STORE === 'memory') store = new MemoryObjectStore();
  else if (bucketConfigured()) store = new S3LegacyObjectStore(config.s3.bucketName);
  else store = new UnconfiguredObjectStore();
  return store;
}

/** Tests only: install a specific store (`null` re-reads the environment). */
export function setLegacyObjectStoreForTests(next: LegacyObjectStore | null): void {
  store = next;
}
