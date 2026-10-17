/**
 * The legacy photo door, `GET /api/images/file/<key>` — kept so no URL Homiio
 * ever handed out breaks while the photos move to Oxy Files.
 *
 * A key names one of the four renditions the old pipeline wrote
 * (`<folder>/<uuid>-<variant>.<ext>`). For each request:
 *
 * 1. If the photo has been MIGRATED (its row carries an Oxy file), the answer
 *    is a 301 to the matching Oxy rendition — a cached listing, a notification,
 *    a shared link all keep working, and the browser remembers the move.
 * 2. Otherwise the bytes still come from Homiio's bucket, as they always did.
 * 3. Every answer is counted in `legacy_media_reads`; zero `served` for the
 *    soak is what retires the bucket (`docs/oxy-files.md`).
 *
 * A migrated photo that Oxy no longer serves (taken down, deleted) answers 404
 * rather than redirecting to a file that will not load.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import type { ImageVariantName } from '@homiio/shared-types';

import config from '../../config';
import { getDb } from '../../db/postgres';
import { images } from '../../db/schema';
import { validateImageStoreKey } from '../../utils/imageStoreKey';
import { OXY_VARIANT_FOR } from './imageUrls';
import { legacyObjectStore } from './legacyObjectStore';
import { countLegacyRead } from './legacyReadCounter';
import { oxyFiles } from './oxyFilesClient';

/** The route the legacy door is mounted at (no trailing slash). */
export const LEGACY_IMAGE_ROUTE = '/api/images/file';

/** `<folder>/<uuid>-<variant>.<ext>` — the only key shape the old pipeline wrote. */
const RENDITION_KEY = /^(.+)\/([0-9a-f-]{36})-(small|medium|large|original)\.[a-z]+$/i;

/** The absolute URL of a legacy key, as rows written before the move carry it. */
export function legacyImageUrl(key: string): string {
  return `${config.publicUrl}${LEGACY_IMAGE_ROUTE}/${key}`;
}

/**
 * Rewrite a direct S3 object URL (written before even the API-proxy delivery
 * existed) onto the legacy route. Anything else passes through — an Oxy URL
 * included.
 */
export function resolveStoredImageUrl(url: string): string {
  if (!url) return url;
  const bucket = config.s3.bucketName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const virtualHosted = new RegExp(`^https://${bucket}\\.s3\\.[^/]+/(.+)$`);
  const pathStyle = config.s3.endpoint
    ? new RegExp(`^${config.s3.endpoint.replace(/\/$/, '')}/${bucket}/(.+)$`)
    : undefined;
  const match = virtualHosted.exec(url) ?? (pathStyle ? pathStyle.exec(url) : undefined);
  return match ? legacyImageUrl(match[1]) : url;
}

export type LegacyImageAnswer =
  | { kind: 'redirect'; location: string }
  | { kind: 'bytes'; buffer: Buffer; contentType: string }
  | { kind: 'missing' }
  | { kind: 'invalid' };

/** Answer one request for a legacy key. */
export async function resolveLegacyImage(rawKey: string): Promise<LegacyImageAnswer> {
  const validation = validateImageStoreKey(rawKey);
  if (!validation.ok) return { kind: 'invalid' };

  const rendition = RENDITION_KEY.exec(validation.key);
  if (rendition) {
    const [, folder, uuid, variant] = rendition;
    // The original was always written as `-original.jpeg`, whatever the
    // variant asked for, so one indexed lookup finds the row.
    const [row] = await getDb()
      .select({
        oxyFileId: images.oxyFileId,
        status: images.oxyFileStatus,
        visibility: images.oxyFileVisibility,
      })
      .from(images)
      .where(
        and(
          eq(images.keysOriginal, `${folder}/${uuid}-original.jpeg`),
          isNotNull(images.oxyFileId),
        ),
      )
      .limit(1);
    if (row?.oxyFileId) {
      if (row.status !== 'active' || row.visibility === 'private') {
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
  }

  const found = await legacyObjectStore().get(validation.key);
  if (!found) {
    countLegacyRead('public_image', 'missing');
    return { kind: 'missing' };
  }
  countLegacyRead('public_image', 'served');
  // The extension-derived type, never the store's: this door hands out images
  // and nothing else.
  return { kind: 'bytes', buffer: found.buffer, contentType: validation.contentType };
}
