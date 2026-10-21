/**
 * Safety contract for the keys of Homiio's retired bucket, as old photo URLs
 * still carry them.
 *
 * A "key" is the bucket-relative path of a processed image variant, e.g.
 * `city/<uuid>-medium.webp` or `property/<uuid>-original.jpeg`. It arrives from
 * untrusted input — the wildcard tail of `GET /api/images/file/*`, the legacy
 * door that now only redirects to Oxy (`services/files/legacyImages.ts`) — so
 * it MUST be validated before it is looked up. Express decodes percent-escapes
 * in the wildcard (`..%2f..` becomes `../..`), so the value we validate is the
 * already-decoded string; we do NOT decode again (that would corrupt
 * legitimate keys and is unnecessary for safety).
 */
import path from 'path';

/**
 * Image file extensions a legacy photo key may carry, mapped to their
 * `Content-Type`. The old pipeline wrote only processed variants (`.webp` for
 * resized variants, `.jpeg`/`.jpg` for originals); `.png` is permitted for
 * completeness. Anything else (e.g. `.txt`, `.json`, no extension) is refused.
 */
export const SERVABLE_IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * Types a PRIVATE document may be delivered as (`services/files/privateDocuments`
 * hands out an Oxy file only when its type is one of these).
 *
 * The image types, plus `.pdf` — a payslip or a tenancy agreement is as often a
 * PDF as a photo, and `routes/applications.ts` has accepted `application/pdf` on
 * upload since it shipped. Kept as its own allowlist rather than widened into
 * the one above, because the public route must never gain the ability to hand
 * out a PDF.
 */
export const SERVABLE_DOCUMENT_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ...SERVABLE_IMAGE_CONTENT_TYPES,
  '.pdf': 'application/pdf',
  '.gif': 'image/gif',
};

/**
 * Key prefixes the public door must NEVER answer for, whatever the extension.
 *
 * `GET /api/images/file/*` is mounted on `routes/public.ts` and does no
 * authorization. Until #518 it also handed out a tenant's payslip, identity
 * document or tenancy agreement from these prefixes to anyone holding the URL.
 * The bucket is retired and the door now only redirects public photos to
 * Oxy, so nothing behind these prefixes can be reached any more; the refusal
 * stays so the door never answers for a private document's old address.
 * Private documents are read only through their authorizing routes
 * (`services/files/privateDocuments.ts`).
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
  | 'disallowed-extension';

/** A validated key plus the `Content-Type` its extension maps to. */
export interface ValidImageStoreKey {
  ok: true;
  /** The normalized, bucket-relative key. */
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
 * Validate an untrusted legacy photo key by string analysis alone. Returns the normalized key + its content type when safe, or a typed
 * rejection. The checks, in order:
 *
 *  - reject empty / whitespace-only keys;
 *  - reject a NUL byte (`\0`) — truncates paths in some syscalls;
 *  - reject backslashes — Windows separators that bypass POSIX `..` checks;
 *  - reject UNC (`\\`/`//`) and drive-letter (`C:`) prefixes;
 *  - reject absolute paths;
 *  - normalize with POSIX semantics and reject if any `..` segment survives
 *    (i.e. the key tries to climb out of its root);
 *  - reject a {@link PRIVATE_KEY_PREFIXES} key — this route has no viewer and
 *    cannot decide who may read tenancy evidence;
 *  - require an allowlisted image extension.
 *
 * The returned `key` is the POSIX-normalized form, which is still relative and
 * contains no `..`.
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

function extensionOf(key: string): string {
  return path.posix.extname(key).toLowerCase();
}

/**
 * The path-safety half: everything that makes a key safe to RESOLVE, and
 * nothing about who may read it.
 *
 * `contentType` on the success value is a placeholder the caller replaces; it
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
