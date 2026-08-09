/**
 * `conversations` and its two child tables — the Sindi assistant transcript.
 *
 * Ported from `models/schemas/ConversationSchema.ts`. Empty in production, and
 * the reason it is empty is itself a finding — see the TTL section below.
 *
 * ## `messages[]` is the unbounded embedded array this migration exists to fix
 *
 * It grows with every turn, Mongo rewrote the whole document on each append, and
 * it competes with the 16 MB BSON ceiling. As a child table an append is an
 * INSERT. `CONVENTIONS.md` says an array queried by element becomes a table;
 * this one qualifies on a stronger ground — it is unbounded.
 *
 * ## The TTL index here is DESTRUCTIVE and must NOT be ported as a sweep
 *
 * `{ 'sharing.expiresAt': 1 }, { expireAfterSeconds: 0 }` deletes the WHOLE
 * CONVERSATION, messages and all, once a share link expires — and
 * `generateShareToken` sets that deadline to +24 h. So every conversation anyone
 * has ever shared has been destroyed a day later, along with the transcript the
 * user was sharing.
 *
 * `db/expiry.ts` names this column in `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE` and
 * `__tests__/db/expiry.test.ts` fails if it ever appears in
 * `EXPIRY_SWEEP_TARGETS`. The correct port is to CLEAR the four `sharing_*`
 * columns — which is what `revokeSharing` already does — and `findByShareToken`
 * already refuses an expired token on the read side, so nothing depends on the
 * row being gone.
 */

import { bigint, boolean, check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxyhq/db';

export const CONVERSATION_STATUSES = ['active', 'archived', 'deleted'] as const;
export const CONVERSATION_TOPICS = ['rent', 'repairs', 'lease', 'rights', 'general'] as const;
export const CONVERSATION_SOURCES = ['quick_action', 'example', 'manual', 'url_share'] as const;
export const CONVERSATION_MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export const CONVERSATION_ATTACHMENT_TYPES = ['file', 'image', 'document'] as const;

export const conversations = pgTable(
  'conversations',
  {
    id: generatedId(),

    oxyUserId: text().notNull(),
    title: text().notNull(),
    status: text({ enum: CONVERSATION_STATUSES }).notNull().default('active'),
    topic: text({ enum: CONVERSATION_TOPICS }).notNull().default('general'),

    // ── metadata: a nested path carrying defaults, so it materializes ──
    metadataInitialMessage: text(),
    metadataSource: text({ enum: CONVERSATION_SOURCES }).notNull().default('manual'),
    metadataLanguage: text().notNull().default('en'),
    /** Scalar array, read whole. Lowercased and trimmed at the call site. */
    metadataTags: text().array().notNull().default(sql`'{}'::text[]`),

    // ── sharing ──
    sharingIsShared: boolean().notNull().default(false),
    /** 32 random bytes as hex. NULL when the conversation was never shared. */
    sharingShareToken: text(),
    sharingSharedAt: timestamptz(),
    /** The share link's deadline. NOT a row deadline — see the header. */
    sharingExpiresAt: timestamptz(),

    // ── analytics ──
    //
    // `messageCount` is NOT ported: it is `count(*)` over `conversation_messages`
    // and, unlike `properties.has_images`, it is not a sort key of anything, so
    // no `ORDER BY` has to survive an aggregate. Recorded as an uncarried field
    // in `db/MIGRATION-CONTRACT.md`.
    /**
     * Moves on any save, not only on an append — the same two-timestamps case as
     * `cities.last_updated`, and kept for the same reason: it and `updated_at`
     * are two different facts.
     */
    analyticsLastActivity: timestamptz().notNull(),
    /**
     * Accumulated LLM token spend. NOT derivable from the messages (the count
     * comes from the provider's response, not from the stored text), which is
     * exactly why it survives where `messageCount` does not.
     */
    analyticsTotalTokens: bigint({ mode: 'number' }).notNull().default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('conversations_oxy_user_created_idx').on(
      table.oxyUserId,
      sql`${table.createdAt} desc`,
    ),
    index('conversations_oxy_user_status_updated_idx').on(
      table.oxyUserId,
      table.status,
      sql`${table.updatedAt} desc`,
    ),
    /**
     * Mongo's `unique: true, sparse: true` on `sharing.shareToken`, as a partial
     * unique index. Postgres treats NULLs as distinct so a plain UNIQUE would
     * already behave correctly; partial keeps the index the size of the shared
     * set and states the rule where a reader finds it — the same call
     * `addresses.normalized_key` makes.
     *
     * The token must be written NULL and never `''`: an empty string is a VALUE
     * and would collide for real. `revokeSharing` sets it `undefined`, which is
     * the correct shape.
     */
    uniqueIndex('conversations_share_token_key')
      .on(table.sharingShareToken)
      .where(sql`${table.sharingShareToken} is not null`),
    /**
     * Supports the sweep that CLEARS expired share links (never deletes rows),
     * and `findByShareToken`'s freshness predicate. Partial, because a share
     * deadline exists on a small minority of conversations.
     */
    index('conversations_sharing_expires_at_idx')
      .on(table.sharingExpiresAt)
      .where(sql`${table.sharingExpiresAt} is not null`),
    check(
      'conversations_status_check',
      sql`${table.status} in (${sql.raw(inList(CONVERSATION_STATUSES))})`,
    ),
    check(
      'conversations_topic_check',
      sql`${table.topic} in (${sql.raw(inList(CONVERSATION_TOPICS))})`,
    ),
    check(
      'conversations_metadata_source_check',
      sql`${table.metadataSource} in (${sql.raw(inList(CONVERSATION_SOURCES))})`,
    ),
    /**
     * The four sharing columns move together.
     *
     * `generateShareToken` sets all four and `revokeSharing` clears three of them
     * plus the flag — but nothing enforced it, so a conversation flagged
     * `isShared` with no token is unreachable by its own share link, and a token
     * with `isShared` false is a live secret nobody can revoke through the UI.
     */
    check(
      'conversations_sharing_coherent_check',
      sql`(
        ${table.sharingIsShared}
          and ${table.sharingShareToken} is not null
          and ${table.sharingSharedAt} is not null
          and ${table.sharingExpiresAt} is not null
      ) or (
        not ${table.sharingIsShared}
          and ${table.sharingShareToken} is null
          and ${table.sharingSharedAt} is null
          and ${table.sharingExpiresAt} is null
      )`,
    ),
  ],
);

/**
 * `messages[]` — one turn of the conversation.
 *
 * Declared `{ _id: true }` in Mongo, so every row keeps its id.
 *
 * `position` is the array index and it is not redundant with `timestamp`:
 * `timestamp` defaults to `Date.now` at millisecond resolution, so two turns
 * appended in the same tick sort arbitrarily — and an assistant reply sorted
 * before the question it answers is a transcript that reads as nonsense. Same
 * reasoning as `property_images.order`.
 */
export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: generatedId(),
    conversationId: text()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text({ enum: CONVERSATION_MESSAGE_ROLES }).notNull(),
    content: text().notNull(),
    timestamp: timestamptz().notNull(),
    position: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [
    /**
     * The transcript read, in order. UNIQUE rather than a plain index: two
     * messages at the same position in one conversation is an ordering that has
     * no answer, and an append computing `max(position) + 1` under concurrency
     * is exactly how it happens.
     */
    uniqueIndex('conversation_messages_conversation_position_key').on(
      table.conversationId,
      table.position,
    ),
    check(
      'conversation_messages_role_check',
      sql`${table.role} in (${sql.raw(inList(CONVERSATION_MESSAGE_ROLES))})`,
    ),
  ],
);

/** `messages[].attachments[]` — a file the user attached to a turn. */
export const conversationMessageAttachments = pgTable(
  'conversation_message_attachments',
  {
    id: generatedId(),
    messageId: text()
      .notNull()
      .references(() => conversationMessages.id, { onDelete: 'cascade' }),
    type: text({ enum: CONVERSATION_ATTACHMENT_TYPES }),
    name: text(),
    url: text(),
    /** Bytes. `bigint`, and the one place in this schema where that is about RANGE. */
    size: bigint({ mode: 'number' }),
  },
  (table) => [
    index('conversation_message_attachments_message_id_idx').on(table.messageId),
    check(
      'conversation_message_attachments_type_check',
      sql`${table.type} in (${sql.raw(inList(CONVERSATION_ATTACHMENT_TYPES))})`,
    ),
  ],
);
