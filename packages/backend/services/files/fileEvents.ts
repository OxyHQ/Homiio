/**
 * Oxy file events (ADR 0043 D9) — what Homiio does when a file it shows is
 * deleted, trashed, taken down after a rights claim, restored or made private.
 *
 * `POST /webhooks/oxy/files`, mounted before every body parser (the signature
 * covers the bytes that arrived). The endpoint is registered once per
 * environment in the Oxy console (Webhooks → File events), which answers the
 * challenge below and shows the secret ONCE; it goes into
 * `OXY_FILES_WEBHOOK_SECRET`.
 *
 * ## What an event changes
 *
 * Every `images` row naming the file takes the event's status and visibility,
 * if the event is newer than the last one applied (`oxy_file_event_at`;
 * delivery is at least once and may be out of order). A row whose file is not
 * `active`, or is `private`, is not shown anywhere — listing reads and cover
 * reads skip it (`db/images/servableImages.ts`) — and the listings that showed
 * it re-derive `has_images` in the same transaction, so a listing whose only
 * photo was taken down stops claiming to have photos. An eviction case's
 * cover is read from its own `cover_image_url` copy, so that copy is cleared
 * (and, on the way back, re-derived from the row). A `file.unblocked` or
 * `file.restored` brings everything back the same way.
 *
 * Nothing is deleted here. The listing keeps its photo row: if the takedown is
 * reversed after a counter-notice the photo returns where it was; if the file
 * is deleted for good, the row stays hidden, and the next edit of the listing
 * — or the orphan sweep, once no listing shows it — removes it.
 *
 * ## Dedupe
 *
 * `INSERT … ON CONFLICT DO NOTHING … RETURNING` on `oxy_file_events` in the
 * transaction that applies the event: an empty RETURNING is a redelivery, and
 * both happen or neither does.
 */

import type { FileEvent } from '@oxy.so/core/server';
import { inArray, sql } from 'drizzle-orm';

import { qualified } from '../../db/casing';
import { syncHasImages } from '../../db/hasImages';
import { getDb } from '../../db/postgres';
import { images, oxyFileEvents, propertyImages } from '../../db/schema';
import { OXY_FILE_EVENT_TYPES } from '../../db/schema/oxyFiles';
import { servableImageCondition } from '../../db/images/servableImages';

/** How long an applied event id is remembered (Oxy retries for at most 30 days). */
const DEDUPE_DAYS = 30;

type HandledType = (typeof OXY_FILE_EVENT_TYPES)[number];

function isHandled(type: string): type is HandledType {
  return (OXY_FILE_EVENT_TYPES as readonly string[]).includes(type);
}

const STATUSES = new Set(['active', 'trash', 'blocked', 'deleted']);
const VISIBILITIES = new Set(['public', 'unlisted', 'private']);

export interface FileEventOutcome {
  /** `duplicate` for a redelivery, `ignored` for a type Homiio does not act on. */
  outcome: 'applied' | 'duplicate' | 'ignored';
  /** `images` rows changed. */
  rows: number;
}

/** Apply one verified event. */
export async function applyFileEvent(event: FileEvent): Promise<FileEventOutcome> {
  if (!isHandled(event.type)) return { outcome: 'ignored', rows: 0 };
  const status = STATUSES.has(event.file.status) ? event.file.status : null;
  const visibility = VISIBILITIES.has(event.file.visibility) ? event.file.visibility : null;
  if (!status || !visibility) return { outcome: 'ignored', rows: 0 };
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return { outcome: 'ignored', rows: 0 };

  return getDb().transaction(async (tx) => {
    const claimed = await tx
      .insert(oxyFileEvents)
      .values({
        id: event.id,
        type: event.type as HandledType,
        oxyFileId: event.file.id,
        occurredAt,
        expiresAt: new Date(Date.now() + DEDUPE_DAYS * 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing()
      .returning({ id: oxyFileEvents.id });
    if (claimed.length === 0) return { outcome: 'duplicate', rows: 0 };

    const changed = await tx
      .update(images)
      .set({
        oxyFileStatus: status as 'active',
        oxyFileVisibility: visibility as 'public',
        oxyFileEventAt: occurredAt,
      })
      .where(
        sql`${images.oxyFileId} = ${event.file.id}
          and (${images.oxyFileEventAt} is null or ${images.oxyFileEventAt} < ${occurredAt.toISOString()})`,
      )
      .returning({ id: images.id });

    if (changed.length > 0) {
      const listings = await tx
        .selectDistinct({ propertyId: propertyImages.propertyId })
        .from(propertyImages)
        .where(
          inArray(
            propertyImages.imageId,
            changed.map((row) => row.id),
          ),
        );
      for (const { propertyId } of listings) await syncHasImages(tx, propertyId);

      // Raw SQL on purpose: this is a projection of the images row, not an
      // edit of the case, so it must not move the case's `updated_at`.
      await tx.execute(sql`
        update eviction_cases
        set cover_image_url = case
          when ${servableImageCondition()} then ${qualified(images.urlsMedium)}
          else null
        end
        from images
        where eviction_cases.cover_image_id = ${qualified(images.id)}
          and ${qualified(images.id)} in ${changed.map((row) => row.id)}
      `);
    }
    return { outcome: 'applied', rows: changed.length };
  });
}
