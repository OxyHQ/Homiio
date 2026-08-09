/**
 * `notifications` — the in-app mailbox.
 *
 * Ported from `models/schemas/NotificationSchema.ts`. Empty in production.
 *
 * Notifications target an OXY ACCOUNT rather than a Homiio profile, because one
 * person may own several profiles and the mailbox is per person.
 */

import { boolean, check, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxyhq/db';

export const NOTIFICATION_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export const notifications = pgTable(
  'notifications',
  {
    id: generatedId(),

    recipientOxyUserId: text().notNull(),

    /**
     * The semantic category the client groups and routes on (`property`,
     * `message`, `contract`, `payment`, `reminder`, `system`, `marketing`).
     *
     * NO CHECK, and that is a decision rather than an omission: Mongoose
     * declared a bare required `String` with no `enum`, so the vocabulary has
     * never been enforced and every one of those seven values is a convention in
     * the frontend rather than a rule in the model. Deriving a tuple from a
     * comment would freeze a list nothing has ever validated — the same reasoning
     * `properties.amenities` is left unconstrained under.
     */
    type: text().notNull(),
    title: text().notNull(),
    message: text().notNull(),
    /** Originating app in the Oxy ecosystem. */
    app: text().notNull().default('homiio'),
    priority: text({ enum: NOTIFICATION_PRIORITIES }).notNull().default('medium'),
    read: boolean().notNull().default(false),
    readAt: timestamptz(),

    /**
     * The client's deep-link payload (`{ propertyId, screen, amount, dueDate }`).
     *
     * `jsonb`, and one of the small set that earns it: it is declared
     * `Schema.Types.Mixed` in Mongo precisely because its shape is decided by
     * whichever notifier wrote the row, and every consumer is a client that reads
     * the keys it recognises. Shapelessness is the point, which is the test
     * `CONVENTIONS.md` sets — the same one `addresses.extras` passes.
     */
    data: jsonb().notNull().default({}),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The mailbox, newest first.
    index('notifications_recipient_created_idx').on(
      table.recipientOxyUserId,
      sql`${table.createdAt} desc`,
    ),
    /**
     * The unread badge and the unread-only listing.
     *
     * PARTIAL on `not read`, where Mongo carried the full compound
     * `{ recipient, read, createdAt }`. The badge is a `count(*)` of unread rows
     * and the unread listing is the same set — nobody asks for "my READ
     * notifications" as a separate view — so the index only has to hold the
     * unread ones, and it shrinks as a mailbox is worked through instead of
     * growing forever alongside it.
     */
    index('notifications_recipient_unread_idx')
      .on(table.recipientOxyUserId, sql`${table.createdAt} desc`)
      .where(sql`not ${table.read}`),
    // The mailbox filter chips.
    index('notifications_recipient_type_created_idx').on(
      table.recipientOxyUserId,
      table.type,
      sql`${table.createdAt} desc`,
    ),
    check(
      'notifications_priority_check',
      sql`${table.priority} in (${sql.raw(inList(NOTIFICATION_PRIORITIES))})`,
    ),
  ],
);
