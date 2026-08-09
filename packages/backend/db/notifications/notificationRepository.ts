/**
 * `notifications` — the in-app mailbox, on Postgres.
 *
 * The Mongo collection was empty in production, so this port has no backfill and
 * no consistency window: the first row this repository writes is the first row
 * the table has ever held.
 *
 * ## Two Mongoose behaviours had to be absorbed rather than dropped
 *
 * **`type` and `priority` were coerced with `String(...)` at the controller and
 * defaulted by the schema.** Mongoose applies a `default` at document
 * CONSTRUCTION, so `app: undefined` stored `'homiio'` and `priority: undefined`
 * stored `'medium'`. drizzle does the opposite — an explicit `undefined` in the
 * values object is simply omitted, which lets the column DEFAULT apply, so the
 * two agree here only because every optional column carries its default in the
 * schema. Passing an explicit `null` would NOT agree, and would fail `NOT NULL`;
 * {@link createNotification} therefore takes `undefined` and never `null`.
 *
 * **`read` and `read_at` move together.** Mongo let a row be `read: true` with
 * no `readAt` and vice versa, because the controller wrote them as two
 * independent `$set` keys. There is no CHECK for it — the pair is not one of the
 * coherence rules `db/schema/CONVENTIONS.md` expresses — so it is enforced HERE
 * instead, by {@link markRead} and {@link updateNotification} being the only
 * writers of either column and always writing both.
 */

import { and, count, desc, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import { notifications } from '../schema';
import { NOTIFICATION_PRIORITIES } from '../schema/notifications';

/** A notification priority the schema's CHECK accepts. */
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

/** A row as stored. Every column, since the mailbox DTO carries all of them. */
export type NotificationRow = typeof notifications.$inferSelect;

/**
 * Whether `value` is one of the four declared priorities.
 *
 * Exported because the controller and the dispatch service both have to narrow
 * an untrusted string BEFORE it reaches the insert — a value the CHECK refuses
 * arrives as a `23514` from the driver, which is a 500 rather than the 400 the
 * caller earned.
 */
export function isNotificationPriority(value: unknown): value is NotificationPriority {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_PRIORITIES as readonly string[]).includes(value)
  );
}

export interface CreateNotificationInput {
  readonly recipientOxyUserId: string;
  readonly type: string;
  readonly title: string;
  readonly message: string;
  /** Omitted (never `null`) to take the column default — see the header. */
  readonly app?: string;
  readonly priority?: NotificationPriority;
  readonly data?: Record<string, unknown>;
}

/** Insert one notification and return it. */
export async function createNotification(
  db: DatabaseOrTransaction,
  input: CreateNotificationInput,
): Promise<NotificationRow> {
  const [row] = await db
    .insert(notifications)
    .values({
      recipientOxyUserId: input.recipientOxyUserId,
      type: input.type,
      title: input.title,
      message: input.message,
      app: input.app,
      priority: input.priority,
      data: input.data ?? {},
    })
    .returning();
  return row;
}

export interface ListNotificationsFilter {
  readonly recipientOxyUserId: string;
  readonly unreadOnly?: boolean;
  readonly type?: string;
  readonly priority?: NotificationPriority;
}

export interface ListNotificationsResult {
  readonly rows: readonly NotificationRow[];
  readonly total: number;
  /** Unread across the WHOLE mailbox, deliberately not narrowed by the filter. */
  readonly unreadCount: number;
}

/**
 * The filter shared by the page read and its `count(*)`.
 *
 * One expression rather than two, because a page and a total built from
 * different predicates disagree in a way that only shows up as a last page that
 * is empty or a `hasNext` that never clears.
 */
function listFilter(filter: ListNotificationsFilter): SQL {
  const clauses: SQL[] = [eq(notifications.recipientOxyUserId, filter.recipientOxyUserId)];
  if (filter.unreadOnly) clauses.push(eq(notifications.read, false));
  if (filter.type !== undefined) clauses.push(eq(notifications.type, filter.type));
  if (filter.priority !== undefined) clauses.push(eq(notifications.priority, filter.priority));
  // `and` of a non-empty list is always defined; the cast states that rather
  // than reaching for a non-null assertion.
  return and(...clauses) as SQL;
}

/**
 * One page of the mailbox, newest first, plus the two counts the badge needs.
 *
 * `unreadCount` is the whole mailbox's, matching the Mongo handler: the filter
 * chips change what is LISTED and must not change the badge, or switching to
 * "payments" would appear to clear every other unread notification.
 */
export async function listNotifications(
  db: DatabaseOrTransaction,
  filter: ListNotificationsFilter,
  page: { readonly limit: number; readonly offset: number },
): Promise<ListNotificationsResult> {
  const where = listFilter(filter);
  const [rows, [totalRow], [unreadRow]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ value: count() }).from(notifications).where(where),
    db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientOxyUserId, filter.recipientOxyUserId),
          eq(notifications.read, false),
        ),
      ),
  ]);
  return { rows, total: totalRow.value, unreadCount: unreadRow.value };
}

/**
 * One notification, scoped to its recipient.
 *
 * The recipient is part of the predicate rather than checked afterwards: a
 * lookup by id alone that is authorised in a second statement is an IDOR the
 * moment somebody forgets the second statement.
 */
export async function findNotificationForRecipient(
  db: DatabaseOrTransaction,
  id: string,
  recipientOxyUserId: string,
): Promise<NotificationRow | undefined> {
  const [row] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipientOxyUserId, recipientOxyUserId),
      ),
    )
    .limit(1);
  return row;
}

export interface UpdateNotificationInput {
  /** Writes `read_at` in the same statement — see the header. */
  readonly read?: boolean;
  readonly title?: string;
  readonly message?: string;
  readonly priority?: NotificationPriority;
  readonly data?: Record<string, unknown>;
}

/**
 * Apply a partial update, scoped to the recipient. Returns the row, or
 * `undefined` when it does not exist or belongs to somebody else.
 *
 * A caller passing no changes still gets the row back rather than a no-op
 * `UPDATE`: `updated_at` carries drizzle's `$onUpdate`, so an empty `set` would
 * restamp the row with the moment of a request that changed nothing.
 */
export async function updateNotification(
  db: DatabaseOrTransaction,
  id: string,
  recipientOxyUserId: string,
  input: UpdateNotificationInput,
): Promise<NotificationRow | undefined> {
  const values: Partial<typeof notifications.$inferInsert> = {};
  if (input.read !== undefined) {
    values.read = input.read;
    values.readAt = input.read ? new Date() : null;
  }
  if (input.title !== undefined) values.title = input.title;
  if (input.message !== undefined) values.message = input.message;
  if (input.priority !== undefined) values.priority = input.priority;
  if (input.data !== undefined) values.data = input.data;

  if (Object.keys(values).length === 0) {
    return findNotificationForRecipient(db, id, recipientOxyUserId);
  }

  const [row] = await db
    .update(notifications)
    .set(values)
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipientOxyUserId, recipientOxyUserId),
      ),
    )
    .returning();
  return row;
}

/** Mark one notification read. Returns the row, or `undefined` if not theirs. */
export async function markRead(
  db: DatabaseOrTransaction,
  id: string,
  recipientOxyUserId: string,
): Promise<NotificationRow | undefined> {
  const [row] = await db
    .update(notifications)
    .set({ read: true, readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipientOxyUserId, recipientOxyUserId),
      ),
    )
    .returning();
  return row;
}

/**
 * Mark every unread notification read. Returns how many moved.
 *
 * The `read = false` predicate is what makes the count meaningful AND what keeps
 * `read_at` honest: without it every already-read row would be rewritten with a
 * new `read_at`, restamping when the user read something they read last week.
 */
export async function markAllRead(
  db: DatabaseOrTransaction,
  recipientOxyUserId: string,
): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ read: true, readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientOxyUserId, recipientOxyUserId),
        eq(notifications.read, false),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}

/** Delete one notification, scoped to its recipient. */
export async function deleteNotification(
  db: DatabaseOrTransaction,
  id: string,
  recipientOxyUserId: string,
): Promise<boolean> {
  const rows = await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipientOxyUserId, recipientOxyUserId),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length > 0;
}

/** Delete the whole mailbox. Returns how many rows went. */
export async function deleteAllNotifications(
  db: DatabaseOrTransaction,
  recipientOxyUserId: string,
): Promise<number> {
  const rows = await db
    .delete(notifications)
    .where(eq(notifications.recipientOxyUserId, recipientOxyUserId))
    .returning({ id: notifications.id });
  return rows.length;
}

/**
 * The unread badge on its own.
 *
 * `count()` rather than reading the rows, so the partial
 * `notifications_recipient_unread_idx` can answer it without touching the heap.
 */
export async function countUnread(
  db: DatabaseOrTransaction,
  recipientOxyUserId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientOxyUserId, recipientOxyUserId),
        eq(notifications.read, false),
      ),
    );
  return row.value;
}

/**
 * The wire shape the mailbox client reads.
 *
 * `id` and not `_id` — the wire contract this repository was written against is
 * the one PR #287 made a clean cut to. Timestamps are `Date`s and `res.json`
 * serialises them to ISO, which is what the Mongoose handler shipped; the
 * `db/schema/CONVENTIONS.md` warning about raw strings applies to `db.execute`
 * and not to a drizzle `select`, which runs the column mappers.
 */
export function toNotificationDTO(row: NotificationRow): Record<string, unknown> {
  return {
    id: row.id,
    recipientOxyUserId: row.recipientOxyUserId,
    type: row.type,
    title: row.title,
    message: row.message,
    app: row.app,
    priority: row.priority,
    read: row.read,
    readAt: row.readAt,
    data: row.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
