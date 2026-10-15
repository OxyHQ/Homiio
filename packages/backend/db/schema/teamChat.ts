import { pgTable, text, boolean, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { generatedId, createdAt, inList } from '@oxy.so/db';
import { TEAM_OPERATION_ACTIONS } from '@homiio/contracts';
import { sql } from 'drizzle-orm';
import { evictionCases } from './evictions';
/** Encrypted opaque Allo read reference, never content or a conversation member mirror. */
export const evictionTeamChats = pgTable('eviction_team_chats', {
  caseId: text()
    .primaryKey()
    .references(() => evictionCases.id, { onDelete: 'cascade' }),
  referenceCiphertext: text().notNull(),
});
/** Durable intent for a local membership mutation. Finalization is immutable and replayable. */
export const evictionTeamChatOperations = pgTable(
  'eviction_team_chat_operations',
  {
    id: generatedId(),
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    actorOxyUserId: text().notNull(),
    action: text({ enum: TEAM_OPERATION_ACTIONS }).notNull(),
    subjectOxyUserId: text(),
    targetAccountIds: text().array().notNull(),
    finalized: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'eviction_team_chat_operations_action_check',
      sql`${t.action} in (${sql.raw(inList(TEAM_OPERATION_ACTIONS))})`,
    ),
    check(
      'eviction_team_chat_operations_members_check',
      sql`cardinality(${t.targetAccountIds}) between 1 and 256`,
    ),
    uniqueIndex('eviction_team_chat_operations_pending_key')
      .on(t.caseId)
      .where(sql`not ${t.finalized}`),
  ],
);
