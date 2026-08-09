/**
 * `conversations`, `conversation_messages` and
 * `conversation_message_attachments` — the Sindi assistant transcript, on
 * Postgres.
 *
 * ## The row counts, and what the zero actually means
 *
 * Measured 2026-08-09 from a one-shot on the live task definition:
 *
 * | store | rows |
 * |---|--:|
 * | Mongo `conversations` | **0** |
 * | Mongo messages, summed across every document | **0** |
 * | Postgres `conversations` / `conversation_messages` / `…_attachments` | **0 / 0 / 0** |
 *
 * Zero is not "nobody used the assistant". **Every write path was broken**, and
 * the port is what fixes it, so the number is evidence and not a licence to
 * treat the domain as dead:
 *
 *  - `2d1376a` renamed `Conversation.profileId` to `oxyUserId` and updated the
 *    handlers that lived in `controllers/ai/`. `eeb4845` later deleted that
 *    directory, and `routes/ai.ts` — the file actually mounted at `/api/ai`,
 *    checked against `routes/index.ts` — kept the OLD spelling.
 *  - So every write was `new Conversation({ profileId: … })`. mongoose strict
 *    mode DROPS a path the schema does not declare, `oxyUserId` is
 *    `required: true`, and `save()` therefore throws `ValidationError` every
 *    time. Verified against this repository's mongoose 8.24.1 rather than
 *    reasoned about: the constructed document holds `undefined` for BOTH fields
 *    and `validateSync()` reports "Path `oxyUserId` is required."
 *  - The reads matched: `find({ profileId })` filters on a field no document has
 *    and returns `[]`, so the client saw an empty history rather than an error.
 *  - The collection still carries both generations of index (`profileId_1`,
 *    `oxyUserId_1_status_1_updatedAt_-1`, …), which is the fingerprint of the
 *    half-finished rename.
 *
 * The TTL index is the second reason to distrust a low count here, and
 * `db/expiry.ts` carries it: Mongo deleted the whole conversation 24 hours after
 * anybody shared it. Both hazards point the same way — this table's emptiness
 * says nothing about demand.
 *
 * ## ORDERING: never by the primary key, and this is the table where it bites
 *
 * Every `id` in this schema is `text`, holding a 24-char ObjectId hex for a row
 * that existed before the cutover and a **uuid v7** for one created after it.
 * Those two shapes do not interleave in creation order — they interleave
 * BACKWARDS. A uuid v7 minted in 2026 begins `0199…` (the millisecond clock in
 * hex, left-padded into the first 48 bits), while every ObjectId minted in 2026
 * begins `69…`/`6a…` (a 32-bit unix seconds prefix). `'0' < '6'`, so a
 * lexicographic sort puts **every new row before every legacy row**, whatever
 * their real order.
 *
 * A repository that sorted `conversation_messages` by id would therefore serve a
 * backfilled transcript with every reply the user has since added hoisted to the
 * top — and it would do it silently, and only for the conversations that span
 * the cutover, which is the set no hand-written fixture contains. So:
 *
 *  - messages are ordered by **`position`**, the array index Mongo's
 *    `messages[]` carried, with `timestamp` as the tiebreaker;
 *  - conversations are ordered by **`updated_at desc`**, with the id as a
 *    tiebreaker ONLY, exactly as the Mongo handler's `sort({ updatedAt: -1 })`
 *    did.
 *
 * `__tests__/db/conversationOrdering.test.ts` pins both against a fixture that
 * MIXES a legacy hex id with a uuid v7 and arranges the timestamps so an id sort
 * gives the wrong answer. A fixture with ids of one shape cannot tell the two
 * orderings apart.
 *
 * ## What is denormalised, what became a query, and why each
 *
 * | Mongo | Here | Why |
 * |---|---|---|
 * | `analytics.messageCount` | `count(*)`, in {@link listConversations}' lateral | A `pre('save')` hook maintained it. There is no hook here, and it is not a sort key of anything, so a stored counter would have a writer nobody can see and no reader that needs it to be cheap |
 * | `lastMessage` (a virtual) | the same lateral | It was already computed per read in Mongo — a virtual over the loaded array. Storing it would be new denormalisation, not a port |
 * | `analytics.lastActivity` | KEPT, and {@link touchActivity} is its hook | Not derivable: Mongo moved it on any save, not only on an append, so it and `updated_at` are two different facts. It only stays honest because this module is the sole writer and stamps it on every mutation — a stored value with no maintainer is worse than a join |
 * | `analytics.totalTokens` | KEPT, written by {@link addTokens} | Comes from the provider's response, not from the stored text, so nothing can recompute it |
 *
 * The prompt's other two candidates do not exist in this model: a conversation
 * has ONE owner (`oxy_user_id`) rather than a participant list, and there is no
 * unread counter anywhere in the source.
 *
 * ## Sharing
 *
 * `conversations_sharing_coherent_check` makes the four `sharing_*` columns move
 * together, so {@link shareConversation} and {@link revokeSharing} write all
 * four or none. Mongo enforced nothing, which allowed a conversation flagged
 * `isShared` with no token (unreachable by its own link) and a token with the
 * flag false (a live secret nobody could revoke through the UI).
 */

import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { qualified } from '../casing';
import type { DatabaseOrTransaction } from '../postgres';
import {
  conversationMessageAttachments,
  conversationMessages,
  conversations,
} from '../schema';
import { isUniqueViolation } from '../uniqueViolation';

export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type ConversationAttachmentRow = typeof conversationMessageAttachments.$inferSelect;

/** A message role the `conversation_messages_role_check` accepts. */
export type ConversationMessageRole = ConversationMessageRow['role'];

/** How long a share link lives, matching Mongo's `generateShareToken(24)`. */
export const SHARE_LINK_HOURS = 24;

/** Bytes of entropy in a share token — `crypto.randomBytes(32)`, as hex. */
const SHARE_TOKEN_BYTES = 32;

/** The title `POST /conversations` assigns before a first user message names it. */
export const PLACEHOLDER_CONVERSATION_TITLE = 'New Conversation';

/** One message plus the files attached to it. */
export interface HydratedMessage {
  readonly message: ConversationMessageRow;
  readonly attachments: readonly ConversationAttachmentRow[];
}

/** One conversation and its whole transcript. */
export interface HydratedConversation {
  readonly conversation: ConversationRow;
  readonly messages: readonly HydratedMessage[];
}

/** A conversation in a LIST, with the two figures the sidebar renders. */
export interface ConversationSummary {
  readonly conversation: ConversationRow;
  readonly messageCount: number;
  /** The last turn, or `undefined` for a conversation with no messages yet. */
  readonly lastMessage: ConversationMessageRow | undefined;
}

/** A message as a caller supplies it. `position` is assigned by this module. */
export interface MessageInput {
  readonly role: ConversationMessageRole;
  readonly content: string;
  readonly timestamp?: Date;
  readonly attachments?: readonly AttachmentInput[];
}

/** A file attached to a turn. Every field optional, matching the source schema. */
export interface AttachmentInput {
  readonly type?: ConversationAttachmentRow['type'];
  readonly name?: string;
  readonly url?: string;
  readonly size?: number;
}

/**
 * The transcript for one conversation, in order.
 *
 * `position` first, `timestamp` to break a tie. NOT the id — see the header.
 * `UNIQUE(conversation_id, position)` means a tie is unreachable through this
 * module, so the second key is there for a row some other writer could produce,
 * not for one this code can.
 */
export async function listMessages(
  db: DatabaseOrTransaction,
  conversationId: string,
): Promise<readonly HydratedMessage[]> {
  const messages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.position), asc(conversationMessages.timestamp));
  if (messages.length === 0) return [];

  // By message id rather than by joining back to `conversation_messages`: the
  // ids are already in hand, so the join would only re-derive the set this
  // statement was built from — and `inArray` is the spelling
  // `~/Oxy/AGENTS.md` prescribes for a plain membership test, since a bare
  // array interpolated into a `sql` template renders as a ROW CONSTRUCTOR that
  // Postgres rejects at RUNTIME.
  const attachments = await db
    .select()
    .from(conversationMessageAttachments)
    .where(
      inArray(
        conversationMessageAttachments.messageId,
        messages.map((message) => message.id),
      ),
    );

  const byMessage = new Map<string, ConversationAttachmentRow[]>();
  for (const row of attachments) {
    const list = byMessage.get(row.messageId);
    if (list) list.push(row);
    else byMessage.set(row.messageId, [row]);
  }

  return messages.map((message) => ({
    message,
    attachments: byMessage.get(message.id) ?? [],
  }));
}

/**
 * One conversation owned by `oxyUserId`, with its transcript, or `undefined`.
 *
 * The owner is part of the predicate rather than checked afterwards: a lookup by
 * id alone that is authorised in a second statement is an IDOR the moment
 * somebody forgets the second statement.
 */
export async function findConversationForOwner(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<HydratedConversation | undefined> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.oxyUserId, oxyUserId)))
    .limit(1);
  if (!conversation) return undefined;
  return { conversation, messages: await listMessages(db, conversation.id) };
}

/**
 * A person's conversations, newest activity first, with their counts.
 *
 * `updated_at desc` reproduces the Mongo handler's `sort({ updatedAt: -1 })`;
 * the id is a TIEBREAKER and nothing else. Two conversations sharing a
 * millisecond is not hypothetical here — `date_trunc('milliseconds', now())` is
 * the column default, so a batch write lands them on the same value — and a sort
 * with no tiebreaker is not stable across two calls, which is what makes a
 * paginated list repeat or skip a row.
 *
 * The count and the last message come from ONE lateral rather than a second
 * round trip per conversation: the sidebar renders both for every row it shows.
 */
export async function listConversations(
  db: DatabaseOrTransaction,
  oxyUserId: string,
  filter: { readonly status?: ConversationRow['status'] } = {},
): Promise<readonly ConversationSummary[]> {
  const where = filter.status
    ? and(eq(conversations.oxyUserId, oxyUserId), eq(conversations.status, filter.status))
    : eq(conversations.oxyUserId, oxyUserId);

  // `qualified` on BOTH correlated references, and it is not optional. A drizzle
  // column interpolated into a `sql` template renders BARE when its table is not
  // in that statement's own `FROM` — so a plain `${conversations.id}` would emit
  // `"id"`, which resolves against the SUBQUERY's table
  // (`conversation_messages` has an `id` too), silently comparing two of its own
  // columns and returning a count of 0 for every conversation with no error at
  // all. `db/schema/CONVENTIONS.md` records this as the trap that already
  // shipped once in the sibling oxy-api port.
  const rows = await db
    .select({
      conversation: conversations,
      messageCount: sql<number>`(
        select count(*)::int from ${conversationMessages}
        where ${conversationMessages.conversationId} = ${qualified(conversations.id)}
      )`,
      lastMessageId: sql<string | null>`(
        select ${conversationMessages.id} from ${conversationMessages}
        where ${conversationMessages.conversationId} = ${qualified(conversations.id)}
        order by ${conversationMessages.position} desc, ${conversationMessages.timestamp} desc
        limit 1
      )`,
    })
    .from(conversations)
    .where(where)
    .orderBy(desc(conversations.updatedAt), desc(conversations.id));

  const lastIds = rows.map((row) => row.lastMessageId).filter((id): id is string => id !== null);
  const lastMessages = new Map<string, ConversationMessageRow>();
  if (lastIds.length > 0) {
    const found = await db
      .select()
      .from(conversationMessages)
      .where(inArray(conversationMessages.id, lastIds));
    for (const message of found) lastMessages.set(message.id, message);
  }

  return rows.map((row) => ({
    conversation: row.conversation,
    messageCount: row.messageCount,
    lastMessage: row.lastMessageId ? lastMessages.get(row.lastMessageId) : undefined,
  }));
}

/**
 * Open a conversation, with an optional opening transcript.
 *
 * Runs several statements, so the caller supplies the transaction — a
 * conversation that committed without the messages it was created FROM is a
 * blank chat the user has to start again.
 */
export async function createConversation(
  db: DatabaseOrTransaction,
  input: {
    readonly oxyUserId: string;
    readonly title?: string;
    readonly topic?: ConversationRow['topic'];
    readonly initialMessage?: string;
    readonly source?: ConversationRow['metadataSource'];
    readonly language?: string;
    readonly messages?: readonly MessageInput[];
  },
): Promise<HydratedConversation> {
  const now = new Date();
  const [conversation] = await db
    .insert(conversations)
    .values({
      oxyUserId: input.oxyUserId,
      title: input.title?.trim() || PLACEHOLDER_CONVERSATION_TITLE,
      topic: input.topic,
      metadataInitialMessage: input.initialMessage,
      metadataSource: input.source,
      metadataLanguage: input.language,
      analyticsLastActivity: now,
    })
    .returning();

  if (input.messages && input.messages.length > 0) {
    await insertMessages(db, conversation.id, 0, input.messages);
  }
  return { conversation, messages: await listMessages(db, conversation.id) };
}

/** Insert a run of messages starting at `firstPosition`, with their attachments. */
async function insertMessages(
  db: DatabaseOrTransaction,
  conversationId: string,
  firstPosition: number,
  messages: readonly MessageInput[],
): Promise<readonly ConversationMessageRow[]> {
  const inserted = await db
    .insert(conversationMessages)
    .values(
      messages.map((message, index) => ({
        conversationId,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp ?? new Date(),
        position: firstPosition + index,
      })),
    )
    .returning();

  const attachments = inserted.flatMap((row, index) =>
    (messages[index].attachments ?? []).map((attachment) => ({
      messageId: row.id,
      type: attachment.type,
      name: attachment.name,
      url: attachment.url,
      size: attachment.size,
    })),
  );
  if (attachments.length > 0) {
    await db.insert(conversationMessageAttachments).values(attachments);
  }
  return inserted;
}

/**
 * The next free `position` in a conversation.
 *
 * `max + 1`, which two concurrent appends can both read — and
 * `conversation_messages_conversation_position_key` is what catches that,
 * raising `23505` on the loser instead of storing two messages at one position.
 * {@link appendMessages} retries on it. The schema's docblock explains why the
 * index is UNIQUE rather than plain: two messages at the same position is an
 * ordering with no answer, and an assistant reply sorted before the question it
 * answers is a transcript that reads as nonsense.
 */
async function nextPosition(db: DatabaseOrTransaction, conversationId: string): Promise<number> {
  // **`::int` is load-bearing and is not decoration.** `position` is a `bigint`,
  // and postgres.js hands a bigint aggregate back as a STRING to avoid losing
  // precision past 2^53 — so `max(...) + 1` in JS is STRING CONCATENATION.
  // `tsc` cannot see it, because `sql<number>` is an assertion rather than a
  // cast: the declared type says number and the value is `"7"`, so the next
  // append lands at position 710 instead of 8 and the transcript's order is
  // scrambled for good. Measured, not reasoned about — the real-database suite
  // caught it and nothing else would have.
  //
  // Casting in SQL is the fix rather than `Number(...)` in JS, because it also
  // makes the DECLARED type true. `int4` cannot hold every `bigint`, which is
  // correct here: a conversation with 2^31 turns is not a case to preserve
  // precision for.
  const [row] = await db
    .select({ highest: sql<number>`coalesce(max(${conversationMessages.position}), -1)::int` })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId));
  return row.highest + 1;
}

/** How many times {@link appendMessages} re-reads the tail after losing a race. */
const APPEND_ATTEMPTS = 3;

/**
 * Append messages to a conversation and stamp its activity.
 *
 * Retries on the position unique violation rather than taking a lock: an append
 * races only with another append to the SAME conversation, which is one person
 * with two clients, so the contention is rare and the retry is cheaper than
 * serialising every write behind a row lock.
 *
 * **This function opens its own transaction, one per attempt, and that is the
 * single deviation from the "caller owns the transaction" convention in this
 * module.** It has to: a `23505` aborts the enclosing transaction in Postgres,
 * so a retry issued inside the failed one answers `25P02 current transaction is
 * aborted` rather than succeeding. A caller passing a `Transaction` still works
 * — drizzle opens a SAVEPOINT, which rolls back to exactly the right place.
 */
export async function appendMessages(
  db: DatabaseOrTransaction,
  conversationId: string,
  messages: readonly MessageInput[],
): Promise<readonly ConversationMessageRow[]> {
  if (messages.length === 0) return [];

  let lastError: unknown;
  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const start = await nextPosition(tx, conversationId);
        const inserted = await insertMessages(tx, conversationId, start, messages);
        await touchActivity(tx, conversationId);
        return inserted;
      });
    } catch (error) {
      if (!isUniqueViolation(error, 'conversation_messages_conversation_position_key')) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Move `analytics.last_activity` to now.
 *
 * This is the hook the Mongo `pre('save')` was. `last_activity` is kept as a
 * stored column — see the header — and a stored value whose maintainer went
 * missing in the port is exactly the failure the prompt names, so every mutation
 * in this module ends here.
 *
 * `updated_at` moves too, via drizzle's `$onUpdate`, and that is correct: they
 * are two facts that agree on this path and diverge on the ones that do not
 * touch the transcript.
 */
export async function touchActivity(
  db: DatabaseOrTransaction,
  conversationId: string,
): Promise<void> {
  await db
    .update(conversations)
    .set({ analyticsLastActivity: new Date() })
    .where(eq(conversations.id, conversationId));
}

/**
 * Add to the accumulated LLM token spend.
 *
 * `total_tokens` survives where `messageCount` does not because the figure comes
 * from the provider's response and cannot be recomputed from the stored text.
 * The increment is expressed in SQL so two concurrent turns cannot read the same
 * value and each write it back plus their own.
 */
export async function addTokens(
  db: DatabaseOrTransaction,
  conversationId: string,
  tokens: number,
): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  await db
    .update(conversations)
    .set({
      analyticsTotalTokens: sql`${conversations.analyticsTotalTokens} + ${Math.round(tokens)}`,
    })
    .where(eq(conversations.id, conversationId));
}

/** Rename a conversation, scoped to its owner. */
export async function renameConversation(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
  title: string,
): Promise<ConversationRow | undefined> {
  const [row] = await db
    .update(conversations)
    .set({ title, analyticsLastActivity: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.oxyUserId, oxyUserId)))
    .returning();
  return row;
}

/** Move a conversation between `active`, `archived` and `deleted`, scoped to its owner. */
export async function setConversationStatus(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
  status: ConversationRow['status'],
): Promise<ConversationRow | undefined> {
  const [row] = await db
    .update(conversations)
    .set({ status, analyticsLastActivity: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.oxyUserId, oxyUserId)))
    .returning();
  return row;
}

/**
 * Replace a conversation's whole transcript.
 *
 * `PUT /conversations/:id` accepts a `messages` array and Mongo assigned it over
 * the embedded array, so the ported form deletes and re-inserts. Positions are
 * re-numbered from zero, which is what the assignment did implicitly.
 *
 * The caller supplies the transaction: a delete that committed without its
 * re-insert is a transcript the user cannot get back.
 */
export async function replaceMessages(
  db: DatabaseOrTransaction,
  conversationId: string,
  messages: readonly MessageInput[],
): Promise<readonly ConversationMessageRow[]> {
  await db
    .delete(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId));
  if (messages.length === 0) {
    await touchActivity(db, conversationId);
    return [];
  }
  const inserted = await insertMessages(db, conversationId, 0, messages);
  await touchActivity(db, conversationId);
  return inserted;
}

/** Delete a conversation, scoped to its owner. Messages CASCADE. */
export async function deleteConversation(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<boolean> {
  const rows = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.oxyUserId, oxyUserId)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

/**
 * Mint a share link, scoped to the owner, and return the token.
 *
 * All four `sharing_*` columns are written in one statement because
 * `conversations_sharing_coherent_check` refuses any other combination — which
 * is the schema doing what Mongo's `generateShareToken` only did by convention.
 *
 * **The deadline is on the LINK, not on the row.** Mongo carried a TTL index on
 * `sharing.expiresAt` that deleted the whole conversation, transcript included,
 * 24 hours later. `db/expiry.ts` names the column in
 * `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE` and a test fails the build if it is ever
 * registered as a sweep target; {@link expireShareLinks} is the correct port.
 */
export async function shareConversation(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
  hours: number = SHARE_LINK_HOURS,
): Promise<{ readonly conversation: ConversationRow; readonly token: string } | undefined> {
  const now = new Date();
  const token = crypto.randomBytes(SHARE_TOKEN_BYTES).toString('hex');
  const [row] = await db
    .update(conversations)
    .set({
      sharingIsShared: true,
      sharingShareToken: token,
      sharingSharedAt: now,
      sharingExpiresAt: new Date(now.getTime() + hours * 60 * 60 * 1000),
      analyticsLastActivity: now,
    })
    .where(and(eq(conversations.id, id), eq(conversations.oxyUserId, oxyUserId)))
    .returning();
  return row ? { conversation: row, token } : undefined;
}

/**
 * Withdraw a share link, scoped to the owner.
 *
 * The token is written NULL and never `''`:
 * `conversations_share_token_key` is a partial unique index, Postgres treats
 * NULLs as distinct, and an empty string is a VALUE that would collide with
 * every other revoked conversation for real.
 */
export async function revokeSharing(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<ConversationRow | undefined> {
  const [row] = await db
    .update(conversations)
    .set({
      sharingIsShared: false,
      sharingShareToken: null,
      sharingSharedAt: null,
      sharingExpiresAt: null,
      analyticsLastActivity: new Date(),
    })
    .where(and(eq(conversations.id, id), eq(conversations.oxyUserId, oxyUserId)))
    .returning();
  return row;
}

/**
 * The conversation behind a LIVE share token, with its transcript.
 *
 * The freshness predicate is in the query, exactly as Mongo's
 * `findByShareToken` had it, so an expired link answers "not found" whether or
 * not {@link expireShareLinks} has run since. That is what makes the sweep pure
 * housekeeping rather than a correctness dependency — `db/expiry.ts` calls out
 * the coexistence rule, and this is the read side of it.
 *
 * Takes NO owner: the whole point of the link is that a stranger can follow it.
 */
export async function findConversationByShareToken(
  db: DatabaseOrTransaction,
  token: string,
): Promise<HydratedConversation | undefined> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.sharingShareToken, token),
        eq(conversations.sharingIsShared, true),
        gt(conversations.sharingExpiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!conversation) return undefined;
  return { conversation, messages: await listMessages(db, conversation.id) };
}

/**
 * Clear every share link whose deadline has passed. Returns how many were
 * cleared.
 *
 * **This is the port of Mongo's TTL index on `sharing.expiresAt`, and it must
 * never delete a row.** That index deleted the whole conversation — every
 * message in it — 24 hours after anybody pressed Share, so a near-zero row count
 * in the source is evidence of the DAMAGE rather than of safety.
 * `db/schema/conversations.ts` and `db/expiry.ts` both say so; this is where it
 * stops being advice.
 *
 * The four columns are cleared together because the coherence CHECK accepts no
 * other combination, and the predicate names all of them so a row already
 * cleared is not rewritten — an `UPDATE` that touched it would move `updated_at`
 * through drizzle's `$onUpdate` and restamp a conversation nobody edited.
 */
export async function expireShareLinks(db: DatabaseOrTransaction, now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(conversations)
    .set({
      sharingIsShared: false,
      sharingShareToken: null,
      sharingSharedAt: null,
      sharingExpiresAt: null,
    })
    .where(and(eq(conversations.sharingIsShared, true), lte(conversations.sharingExpiresAt, now)))
    .returning({ id: conversations.id });
  return rows.length;
}

/**
 * A title derived from the first user turn, matching Mongo's `pre('save')`.
 *
 * Fifty characters, trimmed, with an ellipsis when it was cut. Exported so the
 * AI-generated title path and the fallback agree on the shape rather than each
 * spelling it out.
 */
export function titleFromFirstUserMessage(content: string): string {
  const trimmed = content.slice(0, 50).trim();
  return content.length > 50 ? `${trimmed}...` : trimmed;
}
