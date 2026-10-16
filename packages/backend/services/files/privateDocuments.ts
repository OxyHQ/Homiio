/**
 * Private documents — THE one adapter between Homiio and wherever a tenancy's
 * private files are stored.
 *
 * A lease document (usually a PDF), an application's payslip or identity
 * document, a maintenance photo: each is a person's own private file, shown
 * only to the parties Homiio authorizes, never public. Under ADR 0041 each
 * belongs in Oxy Files as a PRIVATE file owned by the person who uploaded it,
 * referenced by the entity that uses it, and read back through a short-lived
 * signed URL Homiio asks Oxy for after its own party check.
 *
 * TODO(oxy-4b): move these into Oxy Files. Today's Oxy API cannot hold them,
 * for two reasons that are both on Oxy's side:
 *   1. a service upload into a person's account (`uploadUserMedia`) is
 *      PUBLIC-only and image/video-only (≤ 40 MiB) — a lease PDF can be
 *      neither, and a private photo cannot be stored private;
 *   2. a service may mint a signed URL (`linkedDownloadUrls`) only for a file
 *      whose OWNER referenced it to the service through their own session, so
 *      a file Homiio stored for them could never be read back by Homiio.
 * Stage 4b brings any-type private uploads into an account by a service and the
 * read-back. The switch is then THIS FILE only: `storePrivateImage` /
 * `storePrivateFile` upload into `owner.ownerOxyUserId`'s account as private
 * (registering `{ entityType: owner.kind, entityId: owner.entityId }`),
 * return `oxy:<fileId>` as the ref, and `readPrivateDocument` answers an
 * `oxy:` ref through a signed URL — while an old `private/…` key keeps
 * reading from the bucket until `scripts/migratePrivateDocumentsToOxy` (to be
 * written with 4b, the same shape as `migrateImagesToOxy`) has copied them.
 * Every caller already passes the owner and entity that switch needs, and
 * already stores the ref this returns, so no controller changes with it.
 *
 * Until then the bytes stay in Homiio's own bucket under `private/`, and
 * every read is counted (`legacy_media_reads`, surface `private_document`)
 * so the bucket's retirement can see that private reads remain.
 */

import { createHash } from 'node:crypto';

import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

import { validatePrivateDocumentKey } from '../../utils/imageStoreKey';
import { legacyObjectStore } from './legacyObjectStore';
import { countLegacyRead } from './legacyReadCounter';

/** Whose document it is, and what uses it — what the Oxy switch will need. */
export interface PrivateDocumentOwner {
  /** The person who uploaded it: the future owner of the Oxy file. */
  ownerOxyUserId: string;
  /** The entity that uses it (the future reference's `entityType`). */
  kind: 'lease' | 'tenant_application' | 'maintenance_request';
  /**
   * That entity's id, when it exists yet. An application's documents are
   * stored before the application row is written; the reference would be
   * registered from the row then.
   */
  entityId?: string;
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
  const key = keyFor(owner, '.webp');
  await legacyObjectStore().putPrivate(key, processed, 'image/webp');
  return {
    ref: key,
    contentType: 'image/webp',
    bytes: processed.length,
    sha256: digest(processed),
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
  const key = keyFor(owner, extension);
  await legacyObjectStore().putPrivate(key, buffer, contentType);
  return { ref: key, contentType, bytes: buffer.length, sha256: digest(buffer) };
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
  const validation = validatePrivateDocumentKey(ref);
  if (!validation.ok) return null;
  const found = await legacyObjectStore().get(validation.key);
  countLegacyRead('private_document', found ? 'served' : 'missing');
  if (!found) return null;
  // The extension-derived type: the store's own label is whatever the writer
  // said, and the allowlist is what decides what this door may hand out.
  return { buffer: found.buffer, contentType: validation.contentType };
}
