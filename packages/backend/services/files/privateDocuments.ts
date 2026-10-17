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
 * ## The bucket path, and the switch
 *
 * New documents go to Oxy only while `OXY_PRIVATE_DOCUMENTS_ENABLED=true`
 * (`config.oxyFiles.privateDocumentsEnabled`), off by default until Oxy's 4c
 * release is verified in production; even then a refusal, an outage or an
 * answer that is not private stores the document in Homiio's bucket under
 * `private/` instead, as before, so an upload never fails because of Oxy. A
 * bucket document keeps reading from the bucket (every read counted in
 * `legacy_media_reads`, surface `private_document`) until
 * `scripts/migratePrivateDocumentsToOxy.ts` moves it — which is how the
 * bucket's private half empties (`storageStatus.ts`).
 */

import { createHash } from 'node:crypto';

import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

import config from '../../config';
import { logger } from '../../middlewares/logging';
import {
  SERVABLE_DOCUMENT_CONTENT_TYPES,
  validatePrivateDocumentKey,
} from '../../utils/imageStoreKey';
import { storedDocumentKey } from '../../utils/storedDocumentKey';
import { legacyImageUrl } from './legacyImages';
import { legacyObjectStore } from './legacyObjectStore';
import { countLegacyRead } from './legacyReadCounter';
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
export function oxyDocumentRef(fileId: string): string {
  if (!OXY_FILE_ID.test(fileId)) throw new Error('Not an Oxy file id');
  return `${OXY_REF_PREFIX}${fileId}`;
}

/** The Oxy file a ref names, or null for a bucket key (or anything else). */
export function oxyFileIdOfRef(ref: string): string | null {
  if (!ref.startsWith(OXY_REF_PREFIX)) return null;
  const id = ref.slice(OXY_REF_PREFIX.length);
  return OXY_FILE_ID.test(id) ? id : null;
}

/**
 * What a document row's `url` column holds for a stored ref: the ref itself
 * for an Oxy file, the delivery-route URL `storedDocumentKey` parses for a
 * bucket key. Nothing serves either publicly; the wire shape never carries it.
 */
export function privateDocumentRowUrl(ref: string): string {
  return oxyFileIdOfRef(ref) ? ref : legacyImageUrl(ref);
}

/** The ref a row's `url` names, or null when it names nothing Homiio stores. */
export function privateDocumentRefFromRowUrl(url: string): string | null {
  if (oxyFileIdOfRef(url)) return url;
  return storedDocumentKey(url, {
    bucketName: config.s3.bucketName,
    endpoint: config.s3.endpoint,
  });
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

/** The folder under `private/` a kind is stored in. */
const FOLDER_FOR: Readonly<Record<PrivateDocumentOwner['kind'], string>> = {
  lease: 'leases',
  tenant_application: 'applications',
  maintenance_request: 'maintenance',
};

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** An id safe to be one path segment: what Homiio's ids look like, nothing else. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

function keyFor(owner: PrivateDocumentOwner, extension: string): string {
  const folder = FOLDER_FOR[owner.kind];
  // The entity id reaches here from a route parameter the caller already
  // resolved to a real row, so it is one of Homiio's ids — but a key is a
  // path, and a segment that is not plainly an id is dropped rather than
  // trusted (the bug `POST /api/images/upload`'s client-chosen folder was).
  const scope =
    owner.entityId && SAFE_SEGMENT.test(owner.entityId) ? `${folder}/${owner.entityId}` : folder;
  // Server-built from the kind, the entity id and a fresh uuid — never from a
  // filename, which is attacker-controlled — and always under `private/`, the
  // prefix the public route refuses and the private door requires.
  return `private/${scope}/${uuidv4()}${extension}`;
}

/**
 * Where the processed bytes go: the uploader's Oxy account when the switch is
 * on and Oxy takes them as a private file, the bucket otherwise.
 */
async function persist(
  owner: PrivateDocumentOwner,
  bytes: Buffer,
  sha256: string,
  contentType: string,
  extension: string,
): Promise<string> {
  if (config.oxyFiles.privateDocumentsEnabled) {
    const fileId = await storeInOxy(owner, bytes, sha256, contentType, extension);
    if (fileId) return oxyDocumentRef(fileId);
  }
  const key = keyFor(owner, extension);
  await legacyObjectStore().putPrivate(key, bytes, contentType);
  return key;
}

/** How long a request waits for Oxy to verify a document it just received. */
const OXY_VERIFY_TIMEOUT_MS = 60_000;

/**
 * Store the bytes as a PRIVATE file in the owner's Oxy account and answer its
 * id — or null when Oxy did not, so the caller falls back to the bucket.
 *
 * Null for a refusal or an outage (logged with the status and code, never the
 * bytes or a URL) and for an answer that is not exactly what was sent: a file
 * that is not `private`, or whose digest differs. Neither should happen on an
 * Oxy that accepted the request, and neither may become a document row.
 */
export async function storeInOxy(
  owner: PrivateDocumentOwner,
  bytes: Buffer,
  sha256: string,
  contentType: string,
  extension: string,
): Promise<string | null> {
  try {
    const { file, deduplicated } = await oxyFiles().uploadUserMediaLarge(
      owner.ownerOxyUserId,
      new Uint8Array(bytes),
      {
        mime: contentType,
        visibility: 'private',
        filename: `${owner.kind}${extension}`,
        sha256,
        verifyTimeoutMs: OXY_VERIFY_TIMEOUT_MS,
      },
    );
    if (file.visibility !== 'private' || file.sha256 !== sha256 || !OXY_FILE_ID.test(file.id)) {
      logger.error('Oxy stored a private document as something else; using the bucket', {
        kind: owner.kind,
        fileId: file.id,
        visibility: file.visibility,
        digestMatches: file.sha256 === sha256,
      });
      return null;
    }
    // Bytes the person already held answer their existing file — and a
    // revocation of Homiio on that file survives the re-upload (stage 4c), so
    // a deduplicated answer is only usable if Homiio can still read it.
    if (deduplicated) {
      const readable = await oxyFiles().linkedDownloadUrls([file.id]);
      if (!readable.some((entry) => entry.id === file.id)) {
        logger.warn('A private document matched a file Homiio may not read; using the bucket', {
          kind: owner.kind,
        });
        return null;
      }
    }
    return file.id;
  } catch (error) {
    logger.warn('Oxy did not store a private document; using the bucket', {
      kind: owner.kind,
      status: oxyErrorStatus(error),
      code: oxyErrorCode(error),
    });
    return null;
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

/** The types a private document may be handed out as, from either store. */
const SERVABLE_TYPES = new Set(Object.values(SERVABLE_DOCUMENT_CONTENT_TYPES));

/**
 * Read a private document's bytes.
 *
 * **This does not authorize anything.** It takes a ref and returns bytes.
 * Every caller must have resolved the document from a row the viewer is
 * entitled to, and say so at its own call site; a caller that passes a ref
 * straight off a request has reproduced the defect the private door exists to
 * fix. `validatePrivateDocumentKey` refuses anything outside the private
 * prefixes, so even such a caller cannot reach a public photo through here.
 */
export async function readPrivateDocument(
  ref: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const fileId = oxyFileIdOfRef(ref);
  if (fileId) return readFromOxy(fileId);
  if (ref.startsWith(OXY_REF_PREFIX)) return null;
  const validation = validatePrivateDocumentKey(ref);
  if (!validation.ok) return null;
  const found = await legacyObjectStore().get(validation.key);
  countLegacyRead('private_document', found ? 'served' : 'missing');
  if (!found) return null;
  // The extension-derived type: the store's own label is whatever the writer
  // said, and the allowlist is what decides what this door may hand out.
  return { buffer: found.buffer, contentType: validation.contentType };
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
