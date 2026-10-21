/**
 * Private documents — THE one adapter between Homiio and wherever a tenancy's
 * private files are stored.
 *
 * A lease document (usually a PDF), an application's payslip or identity
 * document, a maintenance photo: each is a person's own private file, shown
 * only to the parties Homiio authorizes, never public. Under ADR 0043 stage 4c
 * each is a PRIVATE file in the uploader's own Oxy account:
 *
 * - **Stored** with `uploadUserMediaLarge(owner, bytes, { visibility:
 *   'private' })` (`files:user-media:write`). Private never reaches `public/`
 *   or the CDN, and because Homiio stored it FOR the person, Oxy records their
 *   consent for Homiio to read it back. The row keeps `oxy:<fileId>` as the ref.
 * - **Read** with `linkedDownloadUrls([fileId])` (`files:linked:read`), fetched
 *   here and handed to the caller as bytes — the short-lived URL never leaves
 *   the server. Oxy omits a file the person revoked Homiio's access to, trashed
 *   or that was taken down: absence is the refusal, and the caller's 404.
 * - **Used**: the row holding `oxy:<fileId>` is the reference (`lease`,
 *   `tenant_application`, `maintenance_request`; `referenceUsage.ts`), marked by
 *   the triggers of migration `0038_oxy_private_documents` and registered by the
 *   drain like every photo's.
 *
 * Who may read a document is still Homiio's decision, made BEFORE this module
 * is called (the party checks in `domain/*`): Oxy's consent says Homiio may
 * read the file, never which of Homiio's users may.
 *
 * ## Oxy or nothing
 *
 * Every document is in Oxy, and ONLY in Oxy. There is no second store to fall
 * back to — Homiio's own bucket was retired on 2026-10-21 — and a document
 * written anywhere else when Oxy refused it would be one Oxy never knew about:
 * outside the person's file manager and outside their revocation (a person who
 * revoked Homiio on these exact bytes would have had them stored anyway). So a
 * refusal is the upload's answer:
 *
 * - **Transient** — Oxy unreachable, a 5xx, bytes that arrived damaged — is
 *   retried here a couple of times, and a short rate limit is waited out once;
 *   what is still failing answers 503 so the person can try again.
 * - **The person's** — their Oxy storage is full (413), the file is too large
 *   or a type Oxy will not hold (413/415), the bytes are blocked (451), or they
 *   removed Homiio's access to this very file (409) — answers that status with
 *   a message saying what to do.
 * - **Homiio's** — a credential Oxy refuses (401/403), or an answer that is not
 *   the private file that was sent — is logged as an error and answers 503/502:
 *   nothing the person can fix, never a row.
 *
 * A ref is `oxy:<fileId>` and nothing else. When the bucket was retired no
 * document row named a bucket object; a row naming anything else reads as
 * absent (404).
 */

import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { AppError } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import { SERVABLE_DOCUMENT_CONTENT_TYPES } from '../../utils/imageStoreKey';
import { retryAfterMs } from './oxyCallPacer';
import { downloadLinked, oxyErrorCode, oxyErrorStatus, oxyFiles } from './oxyFilesClient';

/** Whose document it is, and what uses it. */
export interface PrivateDocumentOwner {
  /** The person who uploaded it: the owner of the Oxy file. */
  ownerOxyUserId: string;
  /** The entity that uses it (the reference's `entityType`). */
  kind: 'lease' | 'tenant_application' | 'maintenance_request';
  /**
   * That entity's id, when it exists yet. An application's documents are
   * stored before the application row is written; the reference is
   * registered from the row (its trigger), never from here.
   */
  entityId?: string;
}

// ── Refs ────────────────────────────────────────────────────────────────────

const OXY_REF_PREFIX = 'oxy:';
/** What an Oxy file id looks like; the same pattern the maintenance CHECK holds. */
const OXY_FILE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The ref of a document stored in Oxy Files. */
function oxyDocumentRef(fileId: string): string {
  if (!OXY_FILE_ID.test(fileId)) throw new Error('Not an Oxy file id');
  return `${OXY_REF_PREFIX}${fileId}`;
}

/** The Oxy file a ref names, or null for anything else. */
export function oxyFileIdOfRef(ref: string): string | null {
  if (!ref.startsWith(OXY_REF_PREFIX)) return null;
  const id = ref.slice(OXY_REF_PREFIX.length);
  return OXY_FILE_ID.test(id) ? id : null;
}

/**
 * The ref a document row's `url` names — the `oxy:<fileId>` itself — or null
 * when it names nothing Homiio stores (an applicant's own link). The row holds
 * the ref as it is; nothing serves it publicly and the wire shape never
 * carries it.
 */
export function privateDocumentRefFromRowUrl(url: string): string | null {
  return oxyFileIdOfRef(url) ? url : null;
}

/** What a stored private document is, as its row records it. */
export interface StoredPrivateDocument {
  /** What to store on the row and hand back to {@link readPrivateDocument}. */
  ref: string;
  contentType: string;
  bytes: number;
  /** SHA-256 of the STORED bytes, lowercase hex. */
  sha256: string;
  width?: number;
  height?: number;
}

/**
 * The longest edge a private image is stored at: large enough that a crack in
 * a wall is still legible months later, small enough that a request with six
 * attachments is not tens of megabytes of base64.
 */
const PRIVATE_IMAGE_MAX_EDGE = 1600;

/** Decode what can be decoded; portals and phones emit benign libpng warnings. */
const SHARP_DECODE_OPTIONS = { failOn: 'none' } as const;

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** How long a request waits for Oxy to verify a document it just received. */
const OXY_VERIFY_TIMEOUT_MS = 60_000;

/** Waits before each retry of a transient failure — the person is waiting too. */
const TRANSIENT_RETRY_DELAYS_MS = [250, 1_000];

/** The longest rate-limit wait one upload request sits through (once). */
const MAX_RATE_LIMIT_WAIT_MS = 2_000;

let sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Tests only: replace the retry waits (`null` restores real time). */
export function setPrivateDocumentSleepForTests(
  next: ((ms: number) => Promise<void>) | null,
): void {
  sleep = next ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

/**
 * Codes Oxy ends a large upload with (`LargeUploadFailedError`: a code, no
 * HTTP status) that another attempt would only repeat. Every other failure
 * without a status — a damaged transfer, a verification Oxy could not finish,
 * a socket reset — may pass.
 */
const TERMINAL_FAILURE_CODES = new Set([
  'STORAGE_QUOTA_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'CONTENT_BLOCKED',
  'UNSUPPORTED_MEDIA_TYPE',
  'INVALID_SVG',
  'OWNER_GONE',
  // The SDK already waited a full minute for Oxy's verification.
  'VERIFY_TIMEOUT',
]);

function isTransient(error: unknown): boolean {
  const status = oxyErrorStatus(error);
  if (status === undefined) {
    const code = oxyErrorCode(error);
    return code === undefined || !TERMINAL_FAILURE_CODES.has(code);
  }
  return status >= 500 || status === 422;
}

/**
 * The answer an upload Oxy did not take gets: what the person can do about it
 * when it is theirs to fix, "try again" when it is a passing failure, and a
 * logged error when it is Homiio's.
 */
function refusal(owner: PrivateDocumentOwner, error: unknown): AppError {
  const status = oxyErrorStatus(error);
  const code = oxyErrorCode(error);
  const context = { kind: owner.kind, status, code };
  if (code === 'STORAGE_QUOTA_EXCEEDED') {
    logger.warn('Oxy refused a private document: the owner’s storage is full', context);
    return new AppError(
      'Your Oxy storage is full. Free up space in your Oxy account, then upload the document again.',
      413,
      'STORAGE_QUOTA_EXCEEDED',
    );
  }
  if (code === 'PAYLOAD_TOO_LARGE' || status === 413) {
    logger.warn('Oxy refused a private document as too large', context);
    return new AppError('This document is too large to store.', 413, 'DOCUMENT_TOO_LARGE');
  }
  if (code === 'CONTENT_BLOCKED' || status === 451) {
    logger.warn('Oxy refused a private document: its bytes are blocked', context);
    return new AppError(
      'This file cannot be stored: it matches content that has been taken down.',
      451,
      'DOCUMENT_BLOCKED',
    );
  }
  if (code === 'UNSUPPORTED_MEDIA_TYPE' || code === 'INVALID_SVG' || status === 415) {
    logger.warn('Oxy refused a private document’s type', context);
    return new AppError('This type of file cannot be stored.', 415, 'UNSUPPORTED_DOCUMENT_TYPE');
  }
  if (status === 429) {
    logger.warn('Oxy rate-limited a private document upload', context);
    return new AppError(
      'Document storage is busy right now. Please try again in a minute.',
      503,
      'DOCUMENT_STORAGE_BUSY',
    );
  }
  if (isTransient(error) || code === 'VERIFY_TIMEOUT') {
    logger.warn('Oxy could not store a private document', context);
  } else {
    // A 401/403/404/410 or any other answer the person cannot change: Homiio's
    // credential, its scopes, or an owner Oxy does not know. Somebody must look.
    logger.error('Oxy refused a private document upload', context);
  }
  return new AppError(
    'Document storage is unavailable right now. Please try again shortly.',
    503,
    'DOCUMENT_STORAGE_UNAVAILABLE',
  );
}

/**
 * Store the bytes as a PRIVATE file in the owner's Oxy account and answer its
 * ref — or throw the {@link AppError} the upload answers with (see the module
 * header). Never stores anything anywhere else.
 */
async function persist(
  owner: PrivateDocumentOwner,
  bytes: Buffer,
  sha256: string,
  contentType: string,
  extension: string,
): Promise<string> {
  return oxyDocumentRef(await storeInOxy(owner, bytes, sha256, contentType, extension));
}

/**
 * Store the bytes as a PRIVATE file in the owner's Oxy account and answer its
 * id, retrying what may pass; anything else throws the upload's answer.
 *
 * An answer that is not exactly what was sent — a file that is not `private`,
 * or whose digest differs — is refused: it may not become a document row.
 */
async function storeInOxy(
  owner: PrivateDocumentOwner,
  bytes: Buffer,
  sha256: string,
  contentType: string,
  extension: string,
): Promise<string> {
  let transientFailures = 0;
  let rateLimited = false;
  for (;;) {
    let answer: Awaited<ReturnType<ReturnType<typeof oxyFiles>['uploadUserMediaLarge']>>;
    try {
      answer = await oxyFiles().uploadUserMediaLarge(owner.ownerOxyUserId, new Uint8Array(bytes), {
        mime: contentType,
        visibility: 'private',
        filename: `${owner.kind}${extension}`,
        sha256,
        verifyTimeoutMs: OXY_VERIFY_TIMEOUT_MS,
      });
    } catch (error) {
      if (oxyErrorStatus(error) === 429 && !rateLimited) {
        const wait = retryAfterMs(error);
        if (wait <= MAX_RATE_LIMIT_WAIT_MS) {
          rateLimited = true;
          await sleep(wait);
          continue;
        }
      }
      if (isTransient(error) && transientFailures < TRANSIENT_RETRY_DELAYS_MS.length) {
        await sleep(TRANSIENT_RETRY_DELAYS_MS[transientFailures]);
        transientFailures += 1;
        continue;
      }
      throw refusal(owner, error);
    }

    const { file, deduplicated } = answer;
    if (file.visibility !== 'private' || file.sha256 !== sha256 || !OXY_FILE_ID.test(file.id)) {
      logger.error('Oxy stored a private document as something else; refusing it', {
        kind: owner.kind,
        fileId: file.id,
        visibility: file.visibility,
        digestMatches: file.sha256 === sha256,
      });
      throw new AppError(
        'Document storage answered with a different file. The document was not saved; please try again.',
        502,
        'DOCUMENT_STORAGE_MISMATCH',
      );
    }
    // Bytes the person already held answer their existing file — and a
    // revocation of Homiio on that file survives the re-upload (stage 4c). That
    // revocation is the person's decision about THESE bytes, so it is honoured:
    // the upload says so instead of storing the bytes somewhere Oxy cannot see.
    if (deduplicated) {
      const readable = await oxyFiles().linkedDownloadUrls([file.id]);
      if (!readable.some((entry) => entry.id === file.id)) {
        logger.warn('A private document matched a file its owner revoked Homiio on', {
          kind: owner.kind,
        });
        throw new AppError(
          'You removed Homiio’s access to this exact file in your Oxy account. Restore Homiio’s access to it there, or upload a different file.',
          409,
          'DOCUMENT_ACCESS_REVOKED',
        );
      }
    }
    return file.id;
  }
}

/**
 * Store a private IMAGE, re-encoded.
 *
 * The re-encode is the privacy measure: Sharp does not carry metadata across,
 * so the GPS tag a phone writes into a photo taken inside somebody's home goes
 * (ADR 0003). One WebP, not four variants — evidence is looked at, not
 * browsed. The digest is of the STORED bytes, the only ones anybody can ever be
 * shown, so a lease signature bound to it (`lease_documents.content_sha256`)
 * describes what is really there.
 */
export async function storePrivateImage(
  owner: PrivateDocumentOwner,
  buffer: Buffer,
): Promise<StoredPrivateDocument> {
  const metadata = await sharp(buffer, SHARP_DECODE_OPTIONS).metadata();
  const processed = await sharp(buffer, SHARP_DECODE_OPTIONS)
    .rotate()
    .resize(PRIVATE_IMAGE_MAX_EDGE, PRIVATE_IMAGE_MAX_EDGE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
  const sha256 = digest(processed);
  const ref = await persist(owner, processed, sha256, 'image/webp', '.webp');
  return {
    ref,
    contentType: 'image/webp',
    bytes: processed.length,
    sha256,
    ...(metadata.width === undefined ? {} : { width: metadata.width }),
    ...(metadata.height === undefined ? {} : { height: metadata.height }),
  };
}

/**
 * Store a private document byte for byte — a PDF.
 *
 * A PDF is a container, not a raster: Sharp would either throw or return page
 * one as a picture. Stored verbatim, it keeps its own metadata (author,
 * producer, timestamps), which is acceptable for a contract whose metadata
 * names the people who sign it and nothing about the home's coordinates.
 * Images therefore never take this path; the callers' allowlists keep it so.
 */
export async function storePrivateFile(
  owner: PrivateDocumentOwner,
  buffer: Buffer,
  contentType: string,
  extension: string,
): Promise<StoredPrivateDocument> {
  const sha256 = digest(buffer);
  const ref = await persist(owner, buffer, sha256, contentType, extension);
  return { ref, contentType, bytes: buffer.length, sha256 };
}

/**
 * Store whatever a document upload is: a PDF verbatim, anything else as a
 * re-encoded image. The one place that decides, so the three upload routes
 * cannot disagree about it.
 */
export async function storePrivateUpload(
  owner: PrivateDocumentOwner,
  file: { buffer: Buffer; mimetype: string },
): Promise<StoredPrivateDocument> {
  if (file.mimetype === 'application/pdf') {
    return storePrivateFile(owner, file.buffer, 'application/pdf', '.pdf');
  }
  return storePrivateImage(owner, file.buffer);
}

/** The types a private document may be handed out as. */
const SERVABLE_TYPES = new Set(Object.values(SERVABLE_DOCUMENT_CONTENT_TYPES));

/**
 * Read a private document's bytes.
 *
 * **This does not authorize anything.** It takes a ref and returns bytes.
 * Every caller must have resolved the document from a row the viewer is
 * entitled to, and say so at its own call site; a caller that passes a ref
 * straight off a request has reproduced the defect the private door exists to
 * fix. A ref that is not `oxy:<fileId>` names nothing and answers null.
 */
export async function readPrivateDocument(
  ref: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const fileId = oxyFileIdOfRef(ref);
  return fileId ? readFromOxy(fileId) : null;
}

/**
 * A document in its owner's Oxy account, read through Homiio's consent.
 *
 * Null when Oxy does not hand it over — the owner revoked Homiio, trashed or
 * deleted it, or it was taken down — or when it is not a type this door hands
 * out. A transfer whose bytes do not hash to what Oxy recorded is an error,
 * never a document: a lease signature is bound to that digest.
 */
async function readFromOxy(
  fileId: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const entries = await oxyFiles().linkedDownloadUrls([fileId]);
  const entry = entries.find((candidate) => candidate.id === fileId);
  if (!entry || !SERVABLE_TYPES.has(entry.mime)) return null;
  const buffer = await downloadLinked(entry.url);
  if (buffer.length !== entry.size || digest(buffer) !== entry.sha256) {
    throw new Error('An Oxy document did not match its recorded digest');
  }
  return { buffer, contentType: entry.mime };
}
