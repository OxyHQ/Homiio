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

/** Why a candidate key was rejected (stable codes for logging/tests). */
export type ImageStoreKeyRejection =
  | 'empty'
  | 'nul-byte'
  | 'backslash'
  | 'absolute'
  | 'drive-or-unc'
  | 'traversal'
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
 *  - require an allowlisted image extension.
 *
 * The returned `key` is the POSIX-normalized form, which is still store-relative
 * and contains no `..`, so resolving it under the store root cannot escape.
 */
export function validateImageStoreKey(rawKey: string): ImageStoreKeyResult {
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

  const ext = path.posix.extname(normalized).toLowerCase();
  const contentType = SERVABLE_IMAGE_CONTENT_TYPES[ext];
  if (!contentType) {
    return { ok: false, reason: 'disallowed-extension' };
  }

  return { ok: true, key: normalized, contentType };
}
