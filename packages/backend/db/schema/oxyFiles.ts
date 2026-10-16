/**
 * The three tables that keep Homiio's use of Oxy Files honest (ADR 0043).
 *
 * `docs/oxy-files.md` is the model; this file states only what each table is
 * FOR, because each one exists to close a specific way the model would drift.
 *
 * See `CONVENTIONS.md` for the rules every decision below follows.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxy.so/db';

/**
 * The entities that USE an Oxy file, as Homiio registers them with Oxy
 * (`file_references.entity_type`). Each names the row that shows the photo,
 * not the `images` row that records it:
 *
 * - `property` — a listing showing the photo (`property_images`);
 * - `city`, `region` — a geo page's cover (`cities/regions.cover_image_id`);
 * - `eviction_case` — a case's cover (`eviction_cases.cover_image_id`);
 * - `lease`, `tenant_application`, `maintenance_request` — a private document
 *   stored in its uploader's Oxy account (`oxy:<fileId>` in
 *   `lease_documents.url`, `tenant_application_documents.url`,
 *   `maintenance_request_attachments.storage_key`).
 *
 * The entity id is that row's own id. `services/files/referenceUsage.ts` holds
 * the one query per type that says whether a pair is still in use, and the
 * triggers in migrations `0037_oxy_files` and `0038_oxy_private_documents`
 * mark a pair whenever a write could have changed the answer.
 */
export const FILE_REFERENCE_ENTITY_TYPES = [
  'property',
  'city',
  'region',
  'eviction_case',
  // A person's PRIVATE documents, stored in their own Oxy account
  // (`services/files/privateDocuments.ts`): the lease, application or
  // maintenance request that holds the document row is the use.
  'lease',
  'tenant_application',
  'maintenance_request',
] as const;

/**
 * `file_reference_changes` — a (file, entity) pair whose registration with Oxy
 * may be out of date.
 *
 * ## Level-triggered, not an event log
 *
 * A row does not say "add" or "remove". It says "this pair changed; go and
 * look". The drain (`services/files/referenceSync.ts`) reads the CURRENT
 * answer from the tables that show photos and makes Oxy agree with it — add if
 * the pair is in use, remove if not. So two changes to one pair in the wrong
 * order cannot leave the wrong state behind, and a listing whose photos are
 * replaced (delete every row, insert them again, one transaction) is one
 * no-op `exists` rather than a remove racing an add.
 *
 * ## Written by TRIGGERS, in the transaction of the change
 *
 * The removal that matters most has no application code to hang a call on:
 * the expiry sweep deletes listings in bulk and `property_images` CASCADES
 * with them. That cascade is how ~950 photo rows were left using storage for
 * listings that no longer existed. A trigger on the child table fires for
 * the cascade too, in the same transaction, so a removal can never be lost to
 * a crash between the delete and an outbound call. `CONVENTIONS.md` prefers
 * application code to a trigger because a trigger is invisible in the schema
 * file; this comment is where it is made visible, and
 * `__tests__/db/fileReferenceChanges.test.ts` pins every one of them,
 * the cascade included.
 *
 * ## The id is the pair
 *
 * `<entity_type>:<entity_id>:<oxy_file_id>`, minted by the trigger, with NO
 * default — the deviation `CONVENTIONS.md` § Primary keys allows when an id
 * carries a meaning: a second change to a pending pair converges on its row
 * (`generation` + 1) instead of queueing it twice. The drain settles a row
 * only at the generation it read, so a change that lands while the drain is
 * talking to Oxy is never lost.
 *
 * ## Settled, not deleted — for a week
 *
 * A settled row keeps `settled_at`. The nightly reconciliation sends an
 * inventory read from ONE snapshot, and a pair the drain settled after that
 * snapshot may be listed in the wrong state; after the reconciliation commits,
 * every pair settled since the snapshot is marked again and re-checked
 * (`referenceReconcile.ts`). The expiry sweep deletes settled rows a week
 * later; a row Oxy keeps failing stays unsettled, backing off to six hours,
 * visible through `attempts` and `last_error` rather than vanishing.
 */
export const fileReferenceChanges = pgTable(
  'file_reference_changes',
  {
    id: text().primaryKey(),
    oxyFileId: text().notNull(),
    entityType: text({ enum: FILE_REFERENCE_ENTITY_TYPES }).notNull(),
    entityId: text().notNull(),
    /** Bumped by every further change to the pair; see the module header. */
    generation: integer().notNull().default(1),
    attempts: integer().notNull().default(0),
    /** When the pair may next be claimed; a failure pushes it out. */
    availableAt: timestamptz().notNull().default(sql`date_trunc('milliseconds', now())`),
    leaseOwner: text(),
    leaseUntil: timestamptz(),
    /** The last failure, for an operator. Never a URL, never a token. */
    lastError: text(),
    /** When Oxy last agreed with the pair; NULL while it is pending. */
    settledAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /** The drain's claim reads only pending pairs. */
    index('file_reference_changes_pending_idx')
      .on(table.availableAt)
      .where(sql`${table.settledAt} is null`),
    index('file_reference_changes_settled_at_idx').on(table.settledAt),
    check(
      'file_reference_changes_entity_type_check',
      sql`${table.entityType} in (${sql.raw(inList(FILE_REFERENCE_ENTITY_TYPES))})`,
    ),
    check('file_reference_changes_generation_check', sql`${table.generation} > 0`),
  ],
);

/** The Oxy file events Homiio acts on. Every other type is acknowledged and ignored. */
export const OXY_FILE_EVENT_TYPES = [
  'file.deleted',
  'file.visibility_changed',
  'file.trashed',
  'file.restored',
  'file.blocked',
  'file.unblocked',
] as const;

/**
 * `oxy_file_events` — the file events already applied, so a redelivery is a
 * no-op.
 *
 * Oxy delivers at least once and says so; the claim is `INSERT … ON CONFLICT
 * DO NOTHING … RETURNING` here, the same shape as the CrowdSource webhook
 * (`MIGRATION-CONTRACT.md`), because Homiio runs several tasks and an
 * in-process set would only dedupe the task that received both copies.
 *
 * The id is Oxy's event id (no default, for the reason `moderation_events.id`
 * has none). Rows expire after 30 days — Oxy stops retrying a delivery 30 days
 * after it was created — through `db/expiry.ts`.
 */
export const oxyFileEvents = pgTable(
  'oxy_file_events',
  {
    id: text().primaryKey(),
    type: text({ enum: OXY_FILE_EVENT_TYPES }).notNull(),
    oxyFileId: text().notNull(),
    occurredAt: timestamptz().notNull(),
    receivedAt: createdAt(),
    expiresAt: timestamptz().notNull(),
  },
  (table) => [
    index('oxy_file_events_expires_at_idx').on(table.expiresAt),
    check(
      'oxy_file_events_type_check',
      sql`${table.type} in (${sql.raw(inList(OXY_FILE_EVENT_TYPES))})`,
    ),
  ],
);

/** Which legacy door a read came through. */
export const LEGACY_MEDIA_SURFACES = ['public_image', 'private_document'] as const;

/**
 * What the legacy door did:
 * - `redirected` — an old URL of a migrated photo, sent to its Oxy file;
 * - `served` — bytes read from Homiio's own bucket;
 * - `missing` — nothing there.
 */
export const LEGACY_MEDIA_OUTCOMES = ['redirected', 'served', 'missing'] as const;

/**
 * `legacy_media_reads` — how often anything still reads Homiio's own bucket,
 * per day.
 *
 * This is the GATE for retiring the bucket (`docs/oxy-files.md` § Retiring the
 * bucket): the bucket goes only after `served` has been zero for the soak, and
 * an absence of rows must not read as an absence of reads — so the counter is
 * a durable table with a row per (day, surface, outcome), not a log line that
 * a missing log group would turn into silence. Counts are buffered per process
 * and flushed every minute (`services/files/legacyReadCounter.ts`).
 *
 * No expiry: one row per day per pair is a few thousand rows a year, and the
 * history is the evidence the retirement is decided on.
 */
export const legacyMediaReads = pgTable(
  'legacy_media_reads',
  {
    id: generatedId(),
    day: date({ mode: 'string' }).notNull(),
    surface: text({ enum: LEGACY_MEDIA_SURFACES }).notNull(),
    outcome: text({ enum: LEGACY_MEDIA_OUTCOMES }).notNull(),
    reads: bigint({ mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('legacy_media_reads_day_surface_outcome_key').on(
      table.day,
      table.surface,
      table.outcome,
    ),
    check(
      'legacy_media_reads_surface_check',
      sql`${table.surface} in (${sql.raw(inList(LEGACY_MEDIA_SURFACES))})`,
    ),
    check(
      'legacy_media_reads_outcome_check',
      sql`${table.outcome} in (${sql.raw(inList(LEGACY_MEDIA_OUTCOMES))})`,
    ),
    check('legacy_media_reads_reads_check', sql`${table.reads} >= 0`),
  ],
);
