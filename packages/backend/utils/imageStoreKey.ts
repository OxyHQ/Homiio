/**
 * Safety contract for self-hosted LOCAL image store keys.
 *
 * A "key" is the bucket-relative path of a processed image variant, e.g.
 * `city/<uuid>-medium.webp` or `property/<uuid>-original.jpeg`. It arrives from
 * untrusted input — the wildcard tail of `GET /api/images/file/*` — and is used
 * to build a filesystem path under the store root, so it MUST be validated
 * before it ever touches `fs`. Express decodes percent-escapes in the wildcard
 * (`..%2f..` becomes `../..`), so the value we validate is the already-decoded,
 * filesystem-bound string; we do NOT decode again (that would corrupt legitimate
 * keys and is unnecessary for safety).
 *
 * This module is the single source of truth shared by the controller (request
 * gate) and the service (defense-in-depth fs gate) so the two layers can never
 * drift apart on what "safe" means.
 */
import path from 'path';

/**
 * Image file extensions the local store is allowed to serve, mapped to the
 * `Content-Type` returned for each. Only processed variants live in the store
 * (`.webp` for resized variants, `.jpeg`/`.jpg` for originals); `.png` is
 * permitted for completeness. Anything else (e.g. `.txt`, `.json`, no
 * extension) is rejected so the route can never be used to exfiltrate
 * non-image files even if one were somehow placed under the root.
 */
export const SERVABLE_IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * Extensions a PRIVATE document may be delivered as.
 *
 * The image types, plus `.pdf` — a payslip or a tenancy agreement is as often a
 * PDF as a photo, and `routes/applications.ts` has accepted `application/pdf` on
 * upload since it shipped. Kept as its own allowlist rather than widened into
 * the one above, because the public route must never gain the ability to hand
 * out a PDF: that is the difference between the two doors.
 */
export const SERVABLE_DOCUMENT_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ...SERVABLE_IMAGE_CONTENT_TYPES,
  '.pdf': 'application/pdf',
  '.gif': 'image/gif',
};

/**
 * Key prefixes this route must NEVER serve, whatever the extension.
 *
 * `GET /api/images/file/*` is mounted on `routes/public.ts` and does no
 * authorization: it takes a bucket key and returns the bytes. That is correct
 * for a listing photo, which is published on purpose. It was also, until this
 * gate, how a tenant's uploaded payslip or identity document was delivered —
 * `applications/documents/<uuid>-original.jpeg`, `Cache-Control: public,
 * max-age=31536000, immutable`, readable by anyone holding the URL and by every
 * proxy between them. The objects are in a private bucket
 * (`block_public_acls`), so the ONLY thing making them public was this route.
 *
 * Refusing the prefix closes it for the objects already stored, with no data
 * migration: the bytes stay where they are and only the door changes. Tenancy
 * evidence is delivered by an authorizing route instead — see
 * `controllers/applicationController.ts#getApplicationDocument`, whose
 * authorization is the thing that decides, not the unguessability of a uuid.
 *
 * A prefix added here must have such a route, or the documents behind it become
 * unreachable rather than private.
 *
 * `leases/documents/` is the same defect one table over, and a worse one: a
 * tenancy agreement names both parties, the address, the rent and the deposit,
 * and an inspection report photographs the inside of somebody's home. The
 * frontend uploaded them through the ORDINARY image pipeline and posted the
 * resulting `/api/images/file/<key>` URL back, so every lease document ever
 * attached is a permanent, cacheable, shareable link held by anyone who has
 * seen the lease. Refusing the prefix closes it for those objects where they
 * already lie; `GET /api/leases/:id/documents/:documentId` is the door that
 * replaces it. New uploads land under `private/leases/...` instead, so this
 * entry is the one that covers the history rather than the future.
 */
export const PRIVATE_KEY_PREFIXES: readonly string[] = [
  'applications/documents/',
  'leases/documents/',
  'private/',
];

/** Why a candidate key was rejected (stable codes for logging/tests). */
export type ImageStoreKeyRejection =
  | 'empty'
  | 'nul-byte'
  | 'backslash'
  | 'absolute'
  | 'drive-or-unc'
  | 'traversal'
  | 'private-prefix'
  | 'not-private'
  | 'disallowed-extension';

/** A validated key plus the `Content-Type` its extension maps to. */
export interface ValidImageStoreKey {
  ok: true;
  /** The normalized, store-relative key safe to resolve under the store root. */
  key: string;
  /** `Content-Type` for the key's (allowlisted) extension. */
  contentType: string;
}

/** A rejected key carrying the reason it failed validation. */
export interface InvalidImageStoreKey {
  ok: false;
  reason: ImageStoreKeyRejection;
}

export type ImageStoreKeyResult = ValidImageStoreKey | InvalidImageStoreKey;

/** Windows drive-letter prefix (`C:\`, `c:/`). */
const DRIVE_LETTER_PREFIX = /^[a-zA-Z]:/;
/** UNC share prefix (`\\server\share` or `//server/share`). */
const UNC_PREFIX = /^[\\/]{2}/;

/**
 * Validate an untrusted local-image-store key by string analysis alone (no fs
 * access). Returns the normalized key + its content type when safe, or a typed
 * rejection. The checks, in order:
 *
 *  - reject empty / whitespace-only keys;
 *  - reject a NUL byte (`\0`) — truncates paths in some syscalls;
 *  - reject backslashes — Windows separators that bypass POSIX `..` checks;
 *  - reject UNC (`\\`/`//`) and drive-letter (`C:`) prefixes;
 *  - reject absolute paths;
 *  - normalize with POSIX semantics and reject if any `..` segment survives
 *    (i.e. the key tries to climb out of the store root);
 *  - reject a {@link PRIVATE_KEY_PREFIXES} key — this route has no viewer and
 *    cannot decide who may read tenancy evidence;
 *  - require an allowlisted image extension.
 *
 * The returned `key` is the POSIX-normalized form, which is still store-relative
 * and contains no `..`, so resolving it under the store root cannot escape.
 */
export function validateImageStoreKey(rawKey: string): ImageStoreKeyResult {
  const safe = normalizeStoreKeyPath(rawKey);
  if (!safe.ok) return safe;

  // AFTER normalization, so `applications/./documents/x.jpeg` and
  // `a/../applications/documents/x.jpeg` are the same key to this check as they
  // are to the store. Checking the raw string would leave both as doors.
  if (PRIVATE_KEY_PREFIXES.some((prefix) => safe.key.startsWith(prefix))) {
    return { ok: false, reason: 'private-prefix' };
  }

  const contentType = SERVABLE_IMAGE_CONTENT_TYPES[extensionOf(safe.key)];
  if (!contentType) return { ok: false, reason: 'disallowed-extension' };
  return { ok: true, key: safe.key, contentType };
}

/**
 * Validate a key the PRIVATE document route may read.
 *
 * The same path safety, the opposite prefix rule: this one refuses anything NOT
 * under a private prefix. The two validators are deliberately mirror images —
 * a key is servable by exactly one of the two routes, never by both and never
 * by neither, and the test that asserts that is what stops a new prefix being
 * added to one list and forgotten in the other.
 *
 * Authorization is NOT here and cannot be: this module sees a string, not a
 * viewer. The caller resolves the document, proves the viewer may read it, and
 * only then asks for the bytes.
 */
export function validatePrivateDocumentKey(rawKey: string): ImageStoreKeyResult {
  const safe = normalizeStoreKeyPath(rawKey);
  if (!safe.ok) return safe;

  if (!PRIVATE_KEY_PREFIXES.some((prefix) => safe.key.startsWith(prefix))) {
    return { ok: false, reason: 'not-private' };
  }

  const contentType = SERVABLE_DOCUMENT_CONTENT_TYPES[extensionOf(safe.key)];
  if (!contentType) return { ok: false, reason: 'disallowed-extension' };
  return { ok: true, key: safe.key, contentType };
}

function extensionOf(key: string): string {
  return path.posix.extname(key).toLowerCase();
}

/**
 * The path-safety half, shared by both policies: everything that makes a key
 * safe to RESOLVE, and nothing about who may read it.
 *
 * `contentType` on the success value is a placeholder the callers replace; it
 * exists so this can reuse the result union rather than inventing a third.
 */
function normalizeStoreKeyPath(rawKey: string): ImageStoreKeyResult {
  if (rawKey.length === 0 || rawKey.trim().length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (rawKey.includes('\0')) {
    return { ok: false, reason: 'nul-byte' };
  }
  if (rawKey.includes('\\')) {
    return { ok: false, reason: 'backslash' };
  }
  if (UNC_PREFIX.test(rawKey)) {
    return { ok: false, reason: 'drive-or-unc' };
  }
  if (DRIVE_LETTER_PREFIX.test(rawKey)) {
    return { ok: false, reason: 'drive-or-unc' };
  }
  if (path.posix.isAbsolute(rawKey) || path.isAbsolute(rawKey)) {
    return { ok: false, reason: 'absolute' };
  }

  // Collapse `.`/`..`/duplicate separators using POSIX rules. A traversal
  // attempt leaves a leading `..` (or the path becomes exactly `..`).
  const normalized = path.posix.normalize(rawKey);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return { ok: false, reason: 'traversal' };
  }
  // `normalize` can re-introduce a leading slash for inputs like `/a` only when
  // absolute, already handled above; guard anyway so the result is relative.
  if (path.posix.isAbsolute(normalized)) {
    return { ok: false, reason: 'absolute' };
  }

  return { ok: true, key: normalized, contentType: '' };
}
