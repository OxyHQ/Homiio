/**
 * `saved_items`, `saved_searches`, `saved_property_folders` (+ its items) and
 * `recently_viewed` — everything a person keeps.
 *
 * Ported from `models/schemas/SavedSchema.ts`, `SavedSearchSchema.ts`,
 * `SavedPropertyFolderSchema.ts` and `RecentlyViewedSchema.ts`. All empty in
 * production.
 *
 * Every reference into `properties` here is CASCADE, and it is the one group
 * where that is obviously right: these tables hold POINTERS to listings, so a
 * pointer to a reaped external ad is a dead link and nothing else. That is the
 * opposite of `leases`/`reservations`/`commissions`, which hold records of
 * things that happened.
 *
 * ## Three `default: ''` declarations are NOT ported
 *
 * `SavedPropertyFolder.description` and `.properties[].notes` both declare
 * `default: ''`. An empty string is a VALUE and NULL is the absence, so a `''`
 * default is exactly what `findSchemaInvariantViolations` scans for and refuses —
 * and `CONVENTIONS.md` records the live-bug version of it on sparse-unique
 * columns. Both columns are nullable here with no default.
 */

import { boolean, check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, updatedAt } from '@oxyhq/db';
import { properties } from './properties';

/**
 * The one value `Saved.targetType` has ever had.
 *
 * A one-member tuple looks pointless and is not: it is what makes
 * `saved_items.target_id`'s foreign key HONEST. The discriminator is what
 * decides which table the id points into, so the CHECK and the constraint are
 * two halves of one statement — add a second member and the foreign key has to
 * come off in the same change, which a `23503` will say loudly the first time
 * anybody tries.
 */
export const SAVED_TARGET_TYPES = ['property'] as const;

export const savedItems = pgTable(
  'saved_items',
  {
    id: generatedId(),

    oxyUserId: text().notNull(),
    targetType: text({ enum: SAVED_TARGET_TYPES }).notNull(),
    /**
     * The saved listing.
     *
     * A REAL foreign key, unlike `images.entity_id`, which is the other
     * polymorphic column in this schema: that one spans five nouns and can never
     * name a single parent, while this one's discriminator has exactly one value
     * and every call site in the package writes `targetType: 'property'`.
     *
     * It also fixes a live bug by construction. `controllers/property/stats.ts`
     * counts saves with `targetId: new mongoose.Types.ObjectId(propertyId)`
     * against a column Mongo declared `String` — a BSON type mismatch, so the
     * count has always been 0. Under Postgres both sides are `text` and the
     * comparison simply works. A save count that starts being non-zero after the
     * cutover is an EXPECTED condition, not a defect to diagnose; it is the same
     * class of finding as `properties.views`.
     */
    targetId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    notes: text(),
    /**
     * SET NULL: deleting a folder must not delete the saved listings that were
     * filed in it. NULL already means "not in a folder".
     */
    folderId: text().references(() => savedPropertyFolders.id, { onDelete: 'set null' }),

    /**
     * ONE column, where Mongo had two.
     *
     * `SavedSchema` declares an explicit `createdAt: { default: Date.now }` AND
     * `timestamps: true`; mongoose lets the explicit declaration win and writes
     * one field, so there is one fact and one column. The same collapse applies
     * to `saved_searches` below, which declares both `createdAt` and `updatedAt`
     * beside `timestamps: true`.
     */
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /** One save per person per listing — Mongo's own unique compound. */
    uniqueIndex('saved_items_owner_target_key').on(
      table.oxyUserId,
      table.targetType,
      table.targetId,
    ),
    // `savedFolders` aggregates saves by folder for the folder counts.
    index('saved_items_folder_id_idx')
      .on(table.folderId)
      .where(sql`${table.folderId} is not null`),
    // The reverse lookup: "who saved this listing", for the property stats.
    index('saved_items_target_idx').on(table.targetId),
    check(
      'saved_items_target_type_check',
      sql`${table.targetType} in (${sql.raw(inList(SAVED_TARGET_TYPES))})`,
    ),
  ],
);

export const savedSearches = pgTable(
  'saved_searches',
  {
    id: generatedId(),

    oxyUserId: text().notNull(),
    name: text().notNull(),
    query: text().notNull(),
    /**
     * The search filters, exactly as the client sent them.
     *
     * `jsonb`, and one of the small set that earns it: declared
     * `Schema.Types.Mixed`, and its shape is whatever the search UI supports at
     * the moment it was saved — which is precisely why an OLD saved search has
     * to keep working after the filter set changes. Flattening it into columns
     * would make every filter addition a migration and every removal a data loss.
     */
    filters: jsonb().notNull().default({}),
    notificationsEnabled: boolean().notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /** One search per name per person, so a re-save updates rather than duplicates. */
    uniqueIndex('saved_searches_owner_name_key').on(table.oxyUserId, table.name),
    index('saved_searches_owner_created_idx').on(table.oxyUserId, sql`${table.createdAt} desc`),
    /**
     * The alert sweep — "which saved searches want a notification?" — and the
     * only reason `notifications_enabled` is indexed at all. PARTIAL, where Mongo
     * carried the full `{ oxyUserId, notificationsEnabled }` compound: the sweep
     * runs across ALL users, so scoping it by owner answers the wrong question,
     * and the enabled set is the minority.
     */
    index('saved_searches_notifications_enabled_idx')
      .on(table.oxyUserId)
      .where(sql`${table.notificationsEnabled}`),
  ],
);

export const savedPropertyFolders = pgTable(
  'saved_property_folders',
  {
    id: generatedId(),

    oxyUserId: text().notNull(),
    name: text().notNull(),
    /** Nullable with no default — see the header on `default: ''`. */
    description: text(),
    /**
     * Hex colour (`#3B82F6`).
     *
     * No format CHECK. Mongoose validated `/^#[0-9A-F]{6}$/i`, and
     * `CONVENTIONS.md` defers FORMAT validators as a class — the same line that
     * leaves `countries.code` and every `isEmail`/`isURL` validator in this
     * migration unconstrained. Range and relational rules are expressed on empty
     * tables; string-shape rules are not, so the boundary is one a reader can
     * apply rather than a list to memorise.
     */
    color: text().notNull().default('#3B82F6'),
    icon: text().notNull().default('folder-outline'),
    isDefault: boolean().notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * One folder name per person, CASE-INSENSITIVELY.
     *
     * Mongo expressed it as `collation: { locale: 'en', strength: 2 }` on the
     * unique index. Postgres has no per-index collation strength, so the
     * equivalent is a functional unique index on `lower(name)` — which is also
     * what the case-insensitive lookups on `cities`, `regions` and
     * `neighborhoods` use.
     */
    uniqueIndex('saved_property_folders_owner_name_key').on(
      table.oxyUserId,
      sql`lower(${table.name})`,
    ),
  ],
);

/**
 * `SavedPropertyFolder.properties[]` — a listing filed in a folder.
 *
 * A child table on the ground `CONVENTIONS.md` states plainly: Mongo indexed it
 * BY ELEMENT (`{ 'properties.propertyId': 1 }`), so it is queried by element by
 * definition. It is also an array of IDS, which the same section says becomes a
 * real junction table or nothing.
 */
export const savedPropertyFolderItems = pgTable(
  'saved_property_folder_items',
  {
    id: generatedId(),
    folderId: text()
      .notNull()
      .references(() => savedPropertyFolders.id, { onDelete: 'cascade' }),
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    /** Nullable with no default — see the header on `default: ''`. */
    notes: text(),
    savedAt: createdAt(),
  },
  (table) => [
    /**
     * One entry per listing per folder. `addProperty` finds-then-updates, which
     * races itself; the unique key is what makes "already in this folder"
     * answerable.
     */
    uniqueIndex('saved_property_folder_items_key').on(table.folderId, table.propertyId),
    index('saved_property_folder_items_property_id_idx').on(table.propertyId),
  ],
);

export const recentlyViewed = pgTable(
  'recently_viewed',
  {
    id: generatedId(),
    oxyUserId: text().notNull(),
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    viewedAt: createdAt(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /** One row per person per listing; a repeat view moves `viewed_at`. */
    uniqueIndex('recently_viewed_owner_property_key').on(table.oxyUserId, table.propertyId),
    index('recently_viewed_owner_viewed_at_idx').on(
      table.oxyUserId,
      sql`${table.viewedAt} desc`,
    ),
  ],
);
