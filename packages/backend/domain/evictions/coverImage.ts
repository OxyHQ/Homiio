/**
 * An eviction case's cover photo — resolved from the request, then written.
 *
 * The cover is a photo the organiser uploaded through `POST /api/images/upload`
 * into THEIR OWN Oxy account (ADR 0041). The request names it by the Oxy file
 * id the upload answered (`coverImage.imageId`), and an edit that leaves the
 * cover alone names the case's existing `images` row instead.
 *
 * ## What this replaced
 *
 * The case stored the client's `coverImage.imageId` straight into
 * `eviction_cases.cover_image_id` — a foreign key to `images.id` — and the
 * upload answered a storage-key segment, not a row id, so every case created
 * with a photo failed the foreign key. And `coverImage.url` was stored as given,
 * so a case could render any URL anybody chose. Now the id is resolved: the
 * case's own row, or a file Oxy confirms is the caller's own image
 * (`requireOwnAccountImages`), which becomes a new `images` row
 * (`entity_type: 'eviction_case'`). The URL is always the row's own.
 */

import type { DatabaseOrTransaction } from '../../db/postgres';
import { findImageById } from '../../db/images/imageWrites';
import {
  insertOxyImage,
  requireOwnAccountImages,
  type StoredPublicImage,
  storedFromMetadata,
} from '../../services/files/publicImages';
import { sanitizeCoverImage } from './shared';

/** What the request asked for. */
export type CoverIntent =
  | { kind: 'clear' }
  | { kind: 'keep'; imageId: string; url: string }
  | { kind: 'new'; image: StoredPublicImage };

/** The two columns a case stores its cover in. */
export interface CoverColumns {
  coverImageId: string | null;
  coverImageUrl: string | null;
}

/**
 * Resolve `coverImage` from a request. `caseId` is the case being edited (an
 * existing row of THAT case is kept); on create there is none yet.
 */
export async function resolveCoverIntent(
  input: unknown,
  oxyUserId: string,
  caseId?: string,
): Promise<CoverIntent> {
  const { coverImageId: named } = sanitizeCoverImage(input);
  if (!named) return { kind: 'clear' };
  if (caseId) {
    const row = await findImageById(named);
    if (row && row.entityType === 'eviction_case' && row.entityId === caseId) {
      return { kind: 'keep', imageId: row.id, url: row.urlsMedium };
    }
  }
  const owned = await requireOwnAccountImages(oxyUserId, [named]);
  const metadata = owned.get(named);
  if (!metadata) return { kind: 'clear' };
  return { kind: 'new', image: storedFromMetadata(metadata) };
}

/** Write what the intent needs (a new `images` row) and answer the columns. */
export async function coverColumns(
  intent: CoverIntent,
  caseId: string,
  db?: DatabaseOrTransaction,
): Promise<CoverColumns> {
  switch (intent.kind) {
    case 'clear':
      return { coverImageId: null, coverImageUrl: null };
    case 'keep':
      return { coverImageId: intent.imageId, coverImageUrl: intent.url };
    case 'new': {
      const row = await insertOxyImage(
        'eviction_case',
        caseId,
        intent.image,
        { isPrimary: true, order: 0 },
        db,
      );
      return { coverImageId: row.id, coverImageUrl: row.urlsMedium };
    }
  }
}
