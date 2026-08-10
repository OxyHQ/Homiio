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

import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, geography, inList, timestamptz, updatedAt } from '@oxyhq/db';
import { ALERT_CHANNELS, PUSH_PRIVACY_MODES, WATCH_CADENCES } from '@homiio/shared-types';
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
    /**
     * The serialised `LocationSelection` this search is scoped to, or NULL for
     * a row written before the location contract existed (ADR 0002 §11).
     *
     * Deliberately a THIRD field rather than a reshaping of `query`, and
     * deliberately NULLABLE:
     *
     *  - `query` keeps its old meaning (the place LABEL for a legacy row, free
     *    text for a new one) and `filters` is untouched, so every existing row
     *    stays valid and readable. Nothing about this column narrows anything.
     *  - NULL is the discriminator the lazy migration reads. There is **no bulk
     *    backfill**: geocoding every stored label and taking the first hit would
     *    apply the homonym bug to every user at once, silently, inside one
     *    migration — precisely the move ADR 0002 exists to prevent. A row is
     *    resolved on READ, and only when exactly one candidate comes back; two
     *    or none returns `needs_confirmation` and runs no search.
     *
     * `jsonb` for the same reason `filters` is: the selection is a discriminated
     * union whose arms carry different fields, so flattening it into columns
     * would make every new `LocationSelection` kind a migration.
     */
    location: jsonb(),
    notificationsEnabled: boolean().notNull().default(false),

    // ── The watch half (#356) ──
    //
    // A saved search EVOLVES into a watch rather than being copied into a second
    // table, and the reason is that a copy would need an authority. Two rows for
    // one stored intent drift the moment somebody renames one of them, and the
    // read shape #353 consumes (`isPrimaryArea`, through the saved-search API)
    // would then have to name which copy it trusts. Everything below is
    // ADDITIVE: a row written before this landed is a valid watch with alerting
    // switched off, which is what it already meant.

    /**
     * Which version of the search contract this row's `query` was written
     * against. `2` is ADR 0002's; `1` is a row from before it, whose `query`
     * holds a place LABEL rather than free text.
     *
     * Load-bearing rather than bookkeeping. It is the only thing that can tell a
     * legacy row from a deliberate text-only search, because both have
     * `location IS NULL` — and the matcher REFUSES a version-1 row, because
     * reading its label as free text searches for the string "Barcelona" and
     * reading it as a place is the homonym bug ADR 0002 §11.3 exists to refuse.
     * The migration derives it from whether a canonical selection is present,
     * which is the only evidence a stored row carries.
     */
    queryVersion: integer().notNull().default(2),

    /**
     * The area Home opens on.
     *
     * At most one per person, and that is a partial UNIQUE index below rather
     * than a rule in whichever controller happens to set it. A read-then-write
     * "clear the others, then set this one" is two statements, and two requests
     * interleaving them leave a person with two primary areas and Home picking
     * whichever the sort felt like.
     */
    isPrimaryArea: boolean().notNull().default(false),

    /**
     * How often this watch may speak: `instant`, `daily`, `weekly` or `off`.
     *
     * `off` is the DEFAULT and is not the same as deleting the watch — the
     * search is still saved and still reopens, it just says nothing. It also
     * means every row that existed before this column did is silent until its
     * owner asks for otherwise, which is the only defensible default for a
     * feature that sends notifications.
     */
    cadence: text({ enum: WATCH_CADENCES }).notNull().default('off'),

    /** Delivery channels. `in_app` is mandatory — see the CHECK below. */
    channels: text().array().notNull().default(sql`'{in_app}'::text[]`),

    /** Delivers nothing until this passes. NULL means "not muted". */
    mutedUntil: timestamptz(),

    /**
     * The moment this watch started watching.
     *
     * An event that OCCURRED before it never alerts. Together with
     * `housing_domain_events.is_backfill` this is what stops "no notificar la
     * primera indexación de todo el catálogo como miles de nuevos": this half
     * protects a NEW watch from the EXISTING catalogue, and the flag protects an
     * OLD watch from a bulk re-index. Neither covers the other's case.
     *
     * Re-stamped when alerting is switched back ON, so a watch that was silent
     * for a month does not wake up and recite the month.
     */
    alertsActiveFrom: timestamptz().notNull().defaultNow(),

    /**
     * How prudent the lock-screen text must be: `discreet` (default) or
     * `detailed`. The issue requires it to be configurable, and `discreet` names
     * neither the listing nor the area — a push is read by whoever is holding
     * the phone, who is not necessarily its owner.
     */
    pushPrivacyMode: text({ enum: PUSH_PRIVACY_MODES }).notNull().default('discreet'),

    /**
     * The watch's area, as GeoJSON, derived from `location` at write time.
     *
     * DERIVED and cached rather than computed per query, because the matcher's
     * central operation is the inverted one — given a point, which watches
     * contain it — and that needs a GiST index on the watch side. Computing it
     * from `location` per event would be a sequential scan over every watch in
     * the system for every listing that changes, which is the shape the issue
     * rules out by name.
     *
     * NULL when no area could be derived (a named place Homiio holds with a
     * centroid and no extent). Such a watch reports `alertStatus: no_area`
     * rather than matching everything or nothing in silence.
     */
    area: jsonb(),
    /**
     * The same area as PostGIS geography, GENERATED so it cannot drift.
     *
     * A second application-written column would need the two writers to agree
     * forever; a generated one is the same fact expressed twice by the database.
     * Verified against `postgis/postgis:17-3.5`: `ST_GeomFromGeoJSON(jsonb)` is
     * IMMUTABLE enough for a stored generated column, yields SRID 4326, and
     * stays NULL for a NULL input.
     */
    areaGeo: geography().generatedAlwaysAs(
      sql`case when area is null then null else ST_GeomFromGeoJSON(area)::geography end`,
    ),

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
    /**
     * ONE primary area per person, structurally.
     *
     * PARTIAL, and it has to be: a plain `UNIQUE(oxy_user_id, is_primary_area)`
     * would also permit only one NON-primary watch per person, which is absurd
     * and would surface as "you already have a saved search".
     */
    uniqueIndex('saved_searches_primary_area_key')
      .on(table.oxyUserId)
      .where(sql`${table.isPrimaryArea}`),
    /**
     * The matcher's fan-out from the AREA side: given an event's point, which
     * watches contain it. This index is the "estrategia invertida" the issue
     * asks for instead of running each user's query per listing.
     */
    index('saved_searches_area_geo_gist')
      .using('gist', table.areaGeo)
      .where(sql`${table.areaGeo} is not null`),
    check(
      'saved_searches_cadence_check',
      sql`${table.cadence} in (${sql.raw(inList(WATCH_CADENCES))})`,
    ),
    check(
      'saved_searches_push_privacy_mode_check',
      sql`${table.pushPrivacyMode} in (${sql.raw(inList(PUSH_PRIVACY_MODES))})`,
    ),
    /**
     * Channels are a non-empty subset of the vocabulary, and always include the
     * in-app one.
     *
     * THREE separate facts, and the middle one is the trap: `<@` (containment)
     * is TRUE for the empty array — vacuously, since every element of the empty
     * set is in the allowed set — so a schema that only constrains WHICH values
     * may appear has said nothing about whether any must. `cardinality`, not
     * `array_length`, for the reason spelled out on `housing_alerts`.
     */
    check(
      'saved_searches_channels_check',
      sql`${table.channels} <@ ARRAY[${sql.raw(inList(ALERT_CHANNELS))}]::text[]
        and cardinality(${table.channels}) >= 1
        and 'in_app' = any(${table.channels})`,
    ),
    /**
     * THERE IS DELIBERATELY NO CHECK TYING `cadence` TO `location`.
     *
     * The obvious constraint — a cadence other than `off` requires a stored
     * selection — is wrong, and it took writing it to see why. ADR 0002 §11.5
     * says a saved search with notifications and an UNCONFIRMED location "does
     * not fire; it produces one prompt to confirm". That is a row which stores
     * the user's preference and stays silent, and the constraint makes exactly
     * that row unstorable: switching alerts on would have to be REFUSED, so the
     * prompt would have nothing to prompt about and the preference would be lost
     * every time somebody tried.
     *
     * The rule is real and lives where it can be honest about itself: the
     * matcher's `location is not null` predicate, which cannot fire such a
     * watch, and `watchAlertStatus`, which reports
     * `location_needs_confirmation` so the UI can ask. Enforcing it here would
     * have contradicted a landed contract in order to look stricter.
     */
    check(
      'saved_searches_query_version_check',
      sql.raw('query_version >= 1'),
    ),
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
