/**
 * The legacy photo door, `GET /api/images/file/<key>` — kept so no URL Homiio
 * ever handed out breaks now that every photo is in Oxy Files.
 *
 * A key names one of the four renditions the old pipeline wrote
 * (`<folder>/<uuid>-<variant>.<ext>`). Homiio's own bucket was retired on
 * 2026-10-21 (`docs/oxy-files.md`), so the door answers from the `images` row
 * alone:
 *
 * 1. A photo whose row carries an active, public Oxy file answers 301 to the
 *    matching Oxy rendition — a cached listing, a notification, a shared link
 *    all keep working, and the browser remembers the move.
 * 2. Anything else is a 404: a key with no row, a photo Oxy no longer serves
 *    (taken down, deleted, made private), or a key that is not a rendition.
 * 3. Every answer is counted in `legacy_media_reads` (`public_image`,
 *    `redirected` / `missing`); when the redirects stop, the door can go.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import type { ImageVariantName } from '@homiio/shared-types';

import { getDb } from '../../db/postgres';
import { images } from '../../db/schema';
import { validateImageStoreKey } from '../../utils/imageStoreKey';
import { OXY_VARIANT_FOR } from './imageUrls';
import { countLegacyRead } from './legacyReadCounter';
import { oxyFiles } from './oxyFilesClient';

/** The route the legacy door is mounted at (no trailing slash). */
export const LEGACY_IMAGE_ROUTE = '/api/images/file';

/** `<folder>/<uuid>-<variant>.<ext>` — the only key shape the old pipeline wrote. */
const RENDITION_KEY = /^(.+)\/([0-9a-f-]{36})-(small|medium|large|original)\.[a-z]+$/i;

export type LegacyImageAnswer =
  | { kind: 'redirect'; location: string }
  | { kind: 'missing' }
  | { kind: 'invalid' };

/** Answer one request for a legacy key. */
export async function resolveLegacyImage(rawKey: string): Promise<LegacyImageAnswer> {
  const validation = validateImageStoreKey(rawKey);
  if (!validation.ok) return { kind: 'invalid' };

  const rendition = RENDITION_KEY.exec(validation.key);
  if (!rendition) {
    countLegacyRead('public_image', 'missing');
    return { kind: 'missing' };
  }

  const [, folder, uuid, variant] = rendition;
  // The original was always written as `-original.jpeg`, whatever the variant
  // asked for, so one indexed lookup (`images_migrated_keys_original_idx`)
  // finds the row.
  const [row] = await getDb()
    .select({
      oxyFileId: images.oxyFileId,
      status: images.oxyFileStatus,
      visibility: images.oxyFileVisibility,
    })
    .from(images)
    .where(
      and(eq(images.keysOriginal, `${folder}/${uuid}-original.jpeg`), isNotNull(images.oxyFileId)),
    )
    .limit(1);
  if (!row?.oxyFileId || row.status !== 'active' || row.visibility === 'private') {
    countLegacyRead('public_image', 'missing');
    return { kind: 'missing' };
  }
  countLegacyRead('public_image', 'redirected');
  return {
    kind: 'redirect',
    location: oxyFiles().publicUrl(
      row.oxyFileId,
      OXY_VARIANT_FOR[variant.toLowerCase() as ImageVariantName],
    ),
  };
}
