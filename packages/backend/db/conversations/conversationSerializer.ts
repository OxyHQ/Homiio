/**
 * `conversations` rows → the wire shapes `/api/ai/conversations*` and
 * `/api/ai/shared/:token` return.
 *
 * Three shapes, deliberately not one:
 *
 *  - {@link toConversationSummaryDTO} — a row in the sidebar list. Carries
 *    `messageCount` and `lastMessage`, which were Mongoose VIRTUALS and are
 *    computed by the repository's lateral now (`db/MIGRATION-CONTRACT.md` lists
 *    both under "Virtuals a DTO has to compute").
 *  - {@link toConversationDTO} — one conversation with its whole transcript.
 *  - {@link toSharedConversationDTO} — what a STRANGER following a share link
 *    gets, which is the same minus everything identifying.
 *
 * ## The shared shape omits the owner, and that is the whole point of it
 *
 * `GET /api/ai/shared/:token` needs no authentication. The Mongo handler already
 * hand-picked five fields for exactly this reason; picking them here keeps that
 * property when the row gains a column, whereas returning the row minus a
 * blocklist would leak the next one somebody adds. `oxy_user_id`, the share
 * token itself, the token's deadline and the token spend are all absent.
 *
 * ## `messageCount` is not read by the client, and is still emitted
 *
 * `store/conversationStore.ts` derives its own count from `messages.length`. The
 * field is kept because the LIST response omits the transcript, so a client that
 * wants the count without the payload has no other source — and because dropping
 * a field from a response is a wire break, which this port is not for.
 */

import type {
  ConversationRow,
  ConversationSummary,
  HydratedConversation,
  HydratedMessage,
} from './conversationRepository';

/** One turn, with any files attached to it. */
export function toMessageDTO(hydrated: HydratedMessage): Record<string, unknown> {
  return {
    id: hydrated.message.id,
    role: hydrated.message.role,
    content: hydrated.message.content,
    timestamp: hydrated.message.timestamp,
    attachments: hydrated.attachments.map((attachment) => ({
      id: attachment.id,
      type: attachment.type,
      name: attachment.name,
      url: attachment.url,
      size: attachment.size,
    })),
  };
}

/**
 * The shared fields every conversation shape carries.
 *
 * `id` and not `_id` — Mongoose's `toJSON` transform renamed it and PR #287 made
 * that a clean cut across the wire contract.
 */
function core(conversation: ConversationRow): Record<string, unknown> {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    topic: conversation.topic,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

/** One conversation with its whole transcript. */
export function toConversationDTO(hydrated: HydratedConversation): Record<string, unknown> {
  return {
    ...core(hydrated.conversation),
    oxyUserId: hydrated.conversation.oxyUserId,
    messages: hydrated.messages.map(toMessageDTO),
    messageCount: hydrated.messages.length,
    metadata: {
      initialMessage: hydrated.conversation.metadataInitialMessage,
      source: hydrated.conversation.metadataSource,
      language: hydrated.conversation.metadataLanguage,
      tags: hydrated.conversation.metadataTags,
    },
    sharing: {
      isShared: hydrated.conversation.sharingIsShared,
      sharedAt: hydrated.conversation.sharingSharedAt,
      expiresAt: hydrated.conversation.sharingExpiresAt,
    },
    analytics: {
      lastActivity: hydrated.conversation.analyticsLastActivity,
      totalTokens: hydrated.conversation.analyticsTotalTokens,
    },
  };
}

/**
 * A row in the sidebar list.
 *
 * `messages: []` is carried because the Mongo handler carried it — it mapped
 * `o.messages || []` onto every row — and the client's `loadConversations`
 * reads `conv.messages || []` into its store. Emitting the key empty rather than
 * omitting it keeps a client that renders from the list alone at "no messages
 * yet" instead of "undefined".
 */
export function toConversationSummaryDTO(summary: ConversationSummary): Record<string, unknown> {
  return {
    ...core(summary.conversation),
    messageCount: summary.messageCount,
    lastMessage: summary.lastMessage
      ? {
          id: summary.lastMessage.id,
          role: summary.lastMessage.role,
          content: summary.lastMessage.content,
          timestamp: summary.lastMessage.timestamp,
        }
      : null,
    messages: [],
  };
}

/**
 * What a stranger following a share link gets.
 *
 * Deliberately a PICK and not the row minus a blocklist — see the header. The
 * five fields are the ones the Mongo handler chose, plus the message ids the
 * transcript needs.
 */
export function toSharedConversationDTO(hydrated: HydratedConversation): Record<string, unknown> {
  return {
    id: hydrated.conversation.id,
    title: hydrated.conversation.title,
    status: hydrated.conversation.status,
    messages: hydrated.messages.map(toMessageDTO),
    createdAt: hydrated.conversation.createdAt,
    updatedAt: hydrated.conversation.updatedAt,
  };
}
