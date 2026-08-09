/**
 * `images` — the one reusable image table behind every photo in the product.
 *
 * Ported from `models/schemas/ImageSchema.ts`. A stored photo is processed once
 * through the Sharp pipeline into four fixed variants (original / small /
 * medium / large), uploaded to S3, and recorded here: the bucket-relative
 * storage key and the public URL of each variant, plus the source metadata.
 *
 * See `CONVENTIONS.md` for the rules every decision below follows.
 */

import { boolean, check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, updatedAt } from '@oxyhq/db';
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
] as const satisfies readonly ImageEntityType[];

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
    // Mongo stored these as two `_id: false` subdocuments (`keys` and `urls`)
    // with the same four fixed fields each. The variant set is CLOSED and known
    // at schema time, so eight named columns are the honest shape: a child table
    // would model a cardinality that does not exist, and `jsonb` would make
    // `urls.medium` — the single most-read value in the product — unindexable
    // and untyped. The names keep the Mongo path (`keys.medium` →
    // `keys_medium`), which is what lets the backfill's column-coverage check
    // map source to target mechanically.
    keysOriginal: text().notNull(),
    keysSmall: text().notNull(),
    keysMedium: text().notNull(),
    keysLarge: text().notNull(),
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

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The primary access pattern, unchanged from Mongo: an entity's ordered
    // photo list. The two standalone `index: true` declarations Mongo carried on
    // `entityType` and `entityId` are NOT ported — `entity_type` is a leading
    // prefix of this index and a btree serves any leading prefix, and nothing
    // queries an `entity_id` without knowing its type.
    index('images_entity_order_idx').on(table.entityType, table.entityId, table.order),
    check(
      'images_entity_type_check',
      sql`${table.entityType} in (${sql.raw(inList(IMAGE_ENTITY_TYPES))})`,
    ),
  ],
);
