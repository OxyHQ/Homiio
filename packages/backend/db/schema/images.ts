/**
 * `images` — the one reusable image table behind every photo in the product.
 *
 * A row is Homiio's record of ONE photo it shows, and since ADR 0043 (Oxy
 * Files) the bytes live in Oxy: `oxy_file_id` names the file and the four
 * `urls_*` are its Oxy CDN renditions (`services/files/imageUrls.ts`). A row
 * written before the move names four objects in Homiio's own bucket instead
 * (`keys_*`), and keeps them after `scripts/migrateImagesToOxy.ts` copies it,
 * because those keys are what an old URL still asks the legacy route for
 * (`services/files/legacyImages.ts` redirects it). `docs/oxy-files.md` is the
 * whole model.
 *
 * See `CONVENTIONS.md` for the rules every decision below follows.
 */

import { boolean, check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxy.so/db';
import type { ImageEntityType } from '@homiio/shared-types';

/**
 * The entity kinds an image can belong to.
 *
 * `satisfies` keeps every entry a real `ImageEntityType`, so a renamed or
 * deleted member of the shared union fails to compile here. It does NOT catch a
 * member ADDED to the union — that direction is covered by the enum audit the
 * tracking issue requires before the backfill runs, which reads
 * `distinct(entityType)` from production and compares it against this tuple.
 * Guessing at compile time is worth less than measuring the real values.
 */
export const IMAGE_ENTITY_TYPES = [
  'property',
  'city',
  'region',
  'country',
  'profile',
  'eviction_case',
] as const satisfies readonly ImageEntityType[];

/**
 * Who owns the Oxy file a row shows (ADR 0043 D1).
 *
 * - `application`: Homiio itself — scraped listing photos, Wikimedia city
 *   covers. Oxy garbage-collects one nobody references (trash after 24 hours,
 *   deleted 30 days later), which is why every use is registered.
 * - `account`: the person who uploaded it — a host's listing photo, an eviction
 *   case's cover. Never deleted behind that person's back: when Homiio stops
 *   using it, Oxy shows it to them as "not in use".
 */
export const OXY_FILE_OWNERS = ['application', 'account'] as const;

/** The file's status as Oxy last told Homiio (`services/files/fileEvents.ts`). */
export const OXY_FILE_STATUSES = ['active', 'trash', 'blocked', 'deleted'] as const;

/** The file's visibility as Oxy last told Homiio. Only `private` is not servable. */
export const OXY_FILE_VISIBILITIES = ['public', 'unlisted', 'private'] as const;

export const images = pgTable(
  'images',
  {
    id: generatedId(),

    /** Which kind of entity this image belongs to. */
    entityType: text({ enum: IMAGE_ENTITY_TYPES }).notNull(),
    /**
     * The owning entity's id — a `properties.id`, `cities.id`, `regions.id`,
     * `countries.id` or `profiles.id`, decided by `entity_type`.
     *
     * NO foreign key, and it never gets one: a single column cannot reference
     * five tables. It is the one permanent entry in
     * `deferredForeignKeys.ts`'s `ID_COLUMNS_WITHOUT_FOREIGN_KEY` for this
     * migration, which is what stops it reading as an oversight.
     */
    entityId: text().notNull(),

    // ── the four processed variants, flattened ──
    //
    // The wire carries two objects (`keys` and `urls`) with the same four fixed
    // fields each. The variant set is CLOSED and known
    // at schema time, so eight named columns are the honest shape: a child table
    // would model a cardinality that does not exist, and `jsonb` would make
    // `urls.medium` — the single most-read value in the product — unindexable
    // and untyped. The names keep the wire path (`keys.medium` →
    // `keys_medium`), which is what lets a serializer map them mechanically.
    //
    // The keys are NULL on a row born in Oxy: it has no object in Homiio's
    // bucket. `images_storage_check` requires one of the two homes.
    keysOriginal: text(),
    keysSmall: text(),
    keysMedium: text(),
    keysLarge: text(),
    urlsOriginal: text().notNull(),
    urlsSmall: text().notNull(),
    urlsMedium: text().notNull(),
    urlsLarge: text().notNull(),

    /** Pixel width of the source image, when known. */
    width: integer(),
    /** Pixel height of the source image, when known. */
    height: integer(),
    /** Source image format (`jpeg`, `png`, `webp`). */
    format: text().notNull(),
    /** Byte size of the stored original variant. */
    bytes: integer().notNull(),
    /** Optional human caption. */
    caption: text(),
    /** Whether this is the entity's primary/cover image. */
    isPrimary: boolean().notNull().default(false),
    /** Sort order within the entity's image list (ascending). */
    order: integer().notNull().default(0),

    // ── Oxy Files (ADR 0043) ──

    /** The Oxy file holding the bytes. NULL only on a row not yet migrated. */
    oxyFileId: text(),
    /** Who owns that file; set exactly when `oxy_file_id` is. */
    oxyFileOwner: text({ enum: OXY_FILE_OWNERS }),
    /**
     * The file's status and visibility as Oxy's file events last reported them
     * (`file.blocked`, `file.deleted`, `file.visibility_changed` …). A row whose
     * file is not `active`, or is `private`, is not shown anywhere — Oxy would
     * not serve it — and `property_images` reads skip it
     * (`servableImageCondition`).
     */
    oxyFileStatus: text({ enum: OXY_FILE_STATUSES }),
    oxyFileVisibility: text({ enum: OXY_FILE_VISIBILITIES }),
    /**
     * `occurredAt` of the event the two columns above came from. Delivery is at
     * least once and may be out of order, so an event older than this one is
     * not applied.
     */
    oxyFileEventAt: timestamptz(),

    // ── Attribution, for a photo Homiio did not take ──
    //
    // A Wikimedia Commons city cover is licensed (usually CC BY-SA), and the
    // licence requires naming the author, the licence and the source. Oxy keeps
    // the source URL only as hashed provenance, so the credit lives here, next
    // to the photo it belongs to, and is served with it.

    /** The page the photo was taken from (the Commons `File:` page). */
    attributionSourceUrl: text(),
    /** The author as the source names them, markup stripped. */
    attributionAuthor: text(),
    /** The licence's short name (`CC BY-SA 4.0`). */
    attributionLicense: text(),
    /** The licence's own URL, when the source gives one. */
    attributionLicenseUrl: text(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The primary access pattern: an entity's ordered photo list. No standalone
    // index on `entity_type` or `entity_id` — `entity_type` is a leading
    // prefix of this index and a btree serves any leading prefix, and nothing
    // queries an `entity_id` without knowing its type.
    index('images_entity_order_idx').on(table.entityType, table.entityId, table.order),
    check(
      'images_entity_type_check',
      sql`${table.entityType} in (${sql.raw(inList(IMAGE_ENTITY_TYPES))})`,
    ),
    check(
      'images_oxy_file_owner_check',
      sql`${table.oxyFileOwner} in (${sql.raw(inList(OXY_FILE_OWNERS))})`,
    ),
    check(
      'images_oxy_file_status_check',
      sql`${table.oxyFileStatus} in (${sql.raw(inList(OXY_FILE_STATUSES))})`,
    ),
    check(
      'images_oxy_file_visibility_check',
      sql`${table.oxyFileVisibility} in (${sql.raw(inList(OXY_FILE_VISIBILITIES))})`,
    ),
    /**
     * Every row has its bytes SOMEWHERE: an Oxy file (with its owner, status
     * and visibility — the four are one fact), or all four legacy keys. A
     * migrated row has both, which is allowed.
     */
    check(
      'images_storage_check',
      sql`(
        ${table.oxyFileId} is not null and ${table.oxyFileOwner} is not null
          and ${table.oxyFileStatus} is not null and ${table.oxyFileVisibility} is not null
      ) or (
        ${table.oxyFileId} is null and ${table.oxyFileOwner} is null
          and ${table.oxyFileStatus} is null and ${table.oxyFileVisibility} is null
          and ${table.keysOriginal} is not null and ${table.keysSmall} is not null
          and ${table.keysMedium} is not null and ${table.keysLarge} is not null
      )`,
    ),
    /** A credit names at least its source and its licence, or is absent. */
    check(
      'images_attribution_check',
      sql`(
        ${table.attributionSourceUrl} is null and ${table.attributionLicense} is null
          and ${table.attributionAuthor} is null and ${table.attributionLicenseUrl} is null
      ) or (
        ${table.attributionSourceUrl} is not null and ${table.attributionLicense} is not null
      )`,
    ),
    /**
     * File events and the reference changes look a row up by its Oxy file —
     * one file may back several rows (the same photo on two listings).
     */
    index('images_oxy_file_id_idx').on(table.oxyFileId),
    /**
     * The legacy route's redirect: an old `/api/images/file/<key>` URL of a
     * MIGRATED row resolves to its Oxy file by the original key. Partial,
     * because an unmigrated row is served from the bucket and never looked up.
     */
    index('images_migrated_keys_original_idx')
      .on(table.keysOriginal)
      .where(sql`${table.oxyFileId} is not null`),
  ],
);
