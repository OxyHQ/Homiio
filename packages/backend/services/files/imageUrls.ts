/**
 * The four URLs a photo is shown at, for an Oxy file.
 *
 * Homiio's wire has always carried four renditions — `small` (cards),
 * `medium` (the default `url`), `large` (the detail hero) and `original` — and
 * every reader keeps reading them. Oxy renders an image into fixed width rungs
 * itself (re-encoded, rotated by EXIF, metadata stripped), so each Homiio name
 * maps onto the nearest Oxy rung at or above what the old Sharp pipeline
 * produced (300, 600, 1200 px and the full photo):
 *
 * | Homiio   | Oxy variant | was                    |
 * |----------|-------------|------------------------|
 * | small    | `w320`      | 300×300 inside, WebP   |
 * | medium   | `w640`      | 600×600 inside, WebP   |
 * | large    | `w1280`     | 1200×1200 inside, WebP |
 * | original | `w2048`     | the JPEG re-encode     |
 *
 * `original` is deliberately NOT the bare file. Oxy serves a file's own bytes
 * unmodified, and a photo imported from a portal is stored exactly as the
 * portal served it — EXIF, GPS tag and all. ADR 0003 (privacy by precision)
 * forbids Homiio from publishing a home's coordinates through a door nobody
 * is watching, and the rendition is that door closed: every URL Homiio hands
 * out is a re-encode. (A person's own upload is stripped before it reaches
 * Oxy as well — `publicImages.uploadAccountImage`.)
 *
 * The URL is a pure function of the file id, so it is stored on the row like
 * every other image URL, and a change of CDN host is a re-derivation, not a
 * migration of bytes.
 */

import type { ImageVariantName, ImageVariantUrls } from '@homiio/shared-types';

import { oxyFiles } from './oxyFilesClient';

export const OXY_VARIANT_FOR: Readonly<Record<ImageVariantName, string>> = {
  small: 'w320',
  medium: 'w640',
  large: 'w1280',
  original: 'w2048',
};

/** The four rendition URLs of a PUBLIC Oxy file. */
export function oxyImageUrls(fileId: string): ImageVariantUrls {
  const assets = oxyFiles();
  return {
    original: assets.publicUrl(fileId, OXY_VARIANT_FOR.original),
    small: assets.publicUrl(fileId, OXY_VARIANT_FOR.small),
    medium: assets.publicUrl(fileId, OXY_VARIANT_FOR.medium),
    large: assets.publicUrl(fileId, OXY_VARIANT_FOR.large),
  };
}

/**
 * The prefix an upload answers its "keys" with: `oxy:<fileId>`. The publish
 * wizard of an app build released before the move echoes `keys` back, never a
 * `fileId`, so the file id travels in the shape that build already sends.
 */
export const OXY_KEY_PREFIX = 'oxy:';

/** `oxy:<fileId>` → `<fileId>`, or null for anything else (a legacy bucket key). */
export function fileIdFromOxyKey(key: string): string | null {
  if (!key.startsWith(OXY_KEY_PREFIX)) return null;
  const fileId = key.slice(OXY_KEY_PREFIX.length).trim();
  return fileId.length > 0 && /^[A-Za-z0-9_-]{1,128}$/.test(fileId) ? fileId : null;
}
