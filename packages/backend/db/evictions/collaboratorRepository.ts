import { findTeamChat, requireTeamMutationProof } from './teamChatRepository';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import {
  evictionCases,
  evictionCaseCollaborators,
  evictionCaseChanges,
  evictionLocationGrants,
} from '../schema/evictions';

/** All team mutations and private reads take this lock BEFORE checking membership.
 * The second SELECT then sees a removal that committed while the lock waited. */
export async function lockCase(caseId: string, db: DatabaseOrTransaction) {
  const [row] = await db
    .select({ id: evictionCases.id, oxyUserId: evictionCases.oxyUserId })
    .from(evictionCases)
    .where(eq(evictionCases.id, caseId))
    .for('update');
  return row;
}

export async function canEditCase(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const [owner] = await db
    .select({ oxyUserId: evictionCases.oxyUserId })
    .from(evictionCases)
    .where(eq(evictionCases.id, caseId));
  if (!owner) return false;
  if (owner.oxyUserId === oxyUserId) return true;
  const [member] = await db
    .select({ id: evictionCaseCollaborators.id })
    .from(evictionCaseCollaborators)
    .where(
      and(
        eq(evictionCaseCollaborators.caseId, caseId),
        eq(evictionCaseCollaborators.oxyUserId, oxyUserId),
      ),
    );
  return Boolean(member);
}

export async function auditCaseChange(
  caseId: string,
  actorOxyUserId: string,
  action: typeof evictionCaseChanges.$inferInsert.action,
  db: DatabaseOrTransaction,
  subjectOxyUserId?: string,
) {
  await db
    .insert(evictionCaseChanges)
    .values({ caseId, caseReference: caseId, actorOxyUserId, action, subjectOxyUserId });
}

export async function getCaseTeam(caseId: string, oxyUserId: string) {
  return getDb().transaction(async (tx) => {
    const owner = await lockCase(caseId, tx);
    if (!owner || !(await canEditCase(caseId, oxyUserId, tx))) return undefined;
    const collaborators = await tx
      .select({
        oxyUserId: evictionCaseCollaborators.oxyUserId,
        addedAt: evictionCaseCollaborators.createdAt,
      })
      .from(evictionCaseCollaborators)
      .where(eq(evictionCaseCollaborators.caseId, caseId));
    return {
      isOwner: owner.oxyUserId === oxyUserId,
      canEdit: true,
      collaborators,
      hasTeamChat: Boolean(await findTeamChat(caseId, tx)),
    };
  });
}

/** The creator owns membership; callers cannot insert the creator as a collaborator. */
export async function changeCollaborator(
  input: {
    caseId: string;
    actorOxyUserId: string;
    oxyUserId: string;
    add: boolean;
    teamOperationId?: string;
  },
  db: DatabaseOrTransaction = getDb(),
) {
  return db.transaction(async (tx) => {
    const owner = await lockCase(input.caseId, tx);
    if (!owner || owner.oxyUserId !== input.actorOxyUserId) return 'not_found' as const;
    if (owner.oxyUserId === input.oxyUserId) return 'creator' as const;
    await requireTeamMutationProof(input, tx);
    const predicate = and(
      eq(evictionCaseCollaborators.caseId, input.caseId),
      eq(evictionCaseCollaborators.oxyUserId, input.oxyUserId),
    );
    const rows = input.add
      ? await tx
          .insert(evictionCaseCollaborators)
          .values({
            caseId: input.caseId,
            oxyUserId: input.oxyUserId,
            addedByOxyUserId: input.actorOxyUserId,
          })
          .onConflictDoNothing()
          .returning({ id: evictionCaseCollaborators.id })
      : await tx
          .delete(evictionCaseCollaborators)
          .where(predicate)
          .returning({ id: evictionCaseCollaborators.id });
    if (!input.add) {
      // A separate older location grant must not silently preserve removed team access.
      await tx
        .update(evictionLocationGrants)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(evictionLocationGrants.caseId, input.caseId),
            eq(evictionLocationGrants.granteeOxyUserId, input.oxyUserId),
            isNull(evictionLocationGrants.revokedAt),
          ),
        );
    }
    if (rows.length)
      await auditCaseChange(
        input.caseId,
        input.actorOxyUserId,
        input.add ? 'collaborator_added' : 'collaborator_removed',
        tx,
        input.oxyUserId,
      );
    return 'ok' as const;
  });
}
