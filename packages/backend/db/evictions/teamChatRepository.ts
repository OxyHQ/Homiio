import { and, eq } from 'drizzle-orm';
import type { BeginTeamOperation, TeamOperation } from '@oxy.so/homiio-contracts';
import { AlloTeamAccessClient } from '@allo/sdk';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import {
  evictionTeamChats,
  evictionTeamChatOperations,
  evictionCaseCollaborators,
} from '../schema';
import { lockCase, changeCollaborator, canEditCase } from './collaboratorRepository';
import {
  openTeamReference,
  sealTeamReference,
  operationCapability,
  referenceHash,
  verifyOperationCapability,
} from '../../services/teamChatSecrets';
import { AppError } from '../../middlewares/errorHandler';

const unavailable = () =>
  new AppError('Complete this team change in Allo before continuing.', 409, 'TEAM_CHAT_PENDING');
const notFound = () => new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND');
export async function findTeamChat(caseId: string, db: DatabaseOrTransaction) {
  const [row] = await db
    .select()
    .from(evictionTeamChats)
    .where(eq(evictionTeamChats.caseId, caseId));
  return row;
}
async function operationDto(
  row: typeof evictionTeamChatOperations.$inferSelect,
  db: DatabaseOrTransaction,
): Promise<TeamOperation> {
  const chat = await findTeamChat(row.caseId, db);
  if (!chat) throw unavailable();
  return {
    id: row.id,
    caseId: row.caseId,
    ownerAccountId: row.actorOxyUserId,
    action: row.action,
    targetAccountIds: row.targetAccountIds,
    teamReferenceHash: referenceHash(openTeamReference(row.caseId, chat.referenceCiphertext)),
    finalized: row.finalized,
  };
}
async function privateOperation(
  row: typeof evictionTeamChatOperations.$inferSelect,
  db: DatabaseOrTransaction,
) {
  const chat = (await findTeamChat(row.caseId, db))!;
  return {
    operation: await operationDto(row, db),
    capability: operationCapability(row.id),
    teamReference: openTeamReference(row.caseId, chat.referenceCiphertext),
  };
}
async function currentAccounts(caseId: string, owner: string, db: DatabaseOrTransaction) {
  const collaborators = await db
    .select({ id: evictionCaseCollaborators.oxyUserId })
    .from(evictionCaseCollaborators)
    .where(eq(evictionCaseCollaborators.caseId, caseId));
  return [owner, ...collaborators.map((m) => m.id)].sort();
}
export async function beginTeamOperation(caseId: string, actor: string, input: BeginTeamOperation) {
  return getDb().transaction(async (tx) => {
    const owner = await lockCase(caseId, tx);
    if (!owner || owner.oxyUserId !== actor) throw notFound();
    if (input.action !== 'open' && (!input.oxyUserId || input.oxyUserId === actor))
      throw new AppError('Invalid collaborator', 422, 'validation_failed');
    const [pending] = await tx
      .select()
      .from(evictionTeamChatOperations)
      .where(
        and(
          eq(evictionTeamChatOperations.caseId, caseId),
          eq(evictionTeamChatOperations.finalized, false),
        ),
      );
    if (pending) {
      if (
        input.action !== 'open' &&
        (pending.action !== input.action || pending.subjectOxyUserId !== input.oxyUserId)
      )
        throw unavailable();
      return privateOperation(pending, tx);
    }
    const members = await currentAccounts(caseId, actor, tx);
    let chat = await findTeamChat(caseId, tx);
    if (chat) {
      const snapshot = await new AlloTeamAccessClient().snapshot(
        openTeamReference(caseId, chat.referenceCiphertext),
      );
      if (snapshot) {
        if (
          snapshot.sourceReference !== caseId ||
          snapshot.ownerAccountId !== actor ||
          JSON.stringify(snapshot.memberAccountIds) !== JSON.stringify(members)
        )
          throw unavailable();
        const [previous] = await tx
          .select()
          .from(evictionTeamChatOperations)
          .where(eq(evictionTeamChatOperations.id, snapshot.operationId));
        // A lost release reply is recovered with the same immutable finalized operation.
        if (snapshot.frozen || input.action === 'open') {
          if (!previous?.finalized) throw unavailable();
          return privateOperation(previous, tx);
        }
      }
    } else {
      [chat] = await tx
        .insert(evictionTeamChats)
        .values({ caseId, referenceCiphertext: sealTeamReference(caseId) })
        .returning();
    }
    const target =
      input.action === 'add'
        ? [...new Set([...members, input.oxyUserId!])].sort()
        : input.action === 'remove'
          ? members.filter((id) => id !== input.oxyUserId)
          : members;
    if (target.length > 256)
      throw new AppError('A team supports up to 256 people.', 422, 'validation_failed');
    const [row] = await tx
      .insert(evictionTeamChatOperations)
      .values({
        caseId,
        actorOxyUserId: actor,
        action: input.action,
        subjectOxyUserId: input.oxyUserId ?? null,
        targetAccountIds: target,
      })
      .returning();
    return privateOperation(row, tx);
  });
}
export async function readTeamOperation(id: string, capability: string) {
  if (!verifyOperationCapability(id, capability)) throw notFound();
  const [row] = await getDb()
    .select()
    .from(evictionTeamChatOperations)
    .where(eq(evictionTeamChatOperations.id, id));
  if (!row) throw notFound();
  return operationDto(row, getDb());
}
async function verifyFrozenOperation(
  row: typeof evictionTeamChatOperations.$inferSelect,
  db: DatabaseOrTransaction,
) {
  const chat = await findTeamChat(row.caseId, db);
  if (!chat) throw unavailable();
  const snapshot = await new AlloTeamAccessClient().snapshot(
    openTeamReference(row.caseId, chat.referenceCiphertext),
  );
  if (
    !snapshot ||
    !snapshot.frozen ||
    snapshot.operationId !== row.id ||
    snapshot.sourceReference !== row.caseId ||
    snapshot.ownerAccountId !== row.actorOxyUserId ||
    JSON.stringify(snapshot.memberAccountIds) !== JSON.stringify([...row.targetAccountIds].sort())
  )
    throw unavailable();
}
/** Called INSIDE the sole collaborator mutation transaction, after its case lock. */
export async function requireTeamMutationProof(
  input: {
    caseId: string;
    actorOxyUserId: string;
    oxyUserId: string;
    add: boolean;
    teamOperationId?: string;
  },
  db: DatabaseOrTransaction,
) {
  if (!(await findTeamChat(input.caseId, db))) return;
  if (!input.teamOperationId) throw unavailable();
  const [operation] = await db
    .select()
    .from(evictionTeamChatOperations)
    .where(eq(evictionTeamChatOperations.id, input.teamOperationId));
  if (
    !operation ||
    operation.finalized ||
    operation.caseId !== input.caseId ||
    operation.actorOxyUserId !== input.actorOxyUserId ||
    operation.subjectOxyUserId !== input.oxyUserId ||
    operation.action !== (input.add ? 'add' : 'remove')
  )
    throw unavailable();
  await verifyFrozenOperation(operation, db);
}
export async function finalizeTeamOperation(id: string, actor: string) {
  return getDb().transaction(async (tx) => {
    const [initial] = await tx
      .select()
      .from(evictionTeamChatOperations)
      .where(eq(evictionTeamChatOperations.id, id));
    if (!initial) throw notFound();
    const owner = await lockCase(initial.caseId, tx);
    if (!owner || owner.oxyUserId !== actor || initial.actorOxyUserId !== actor) throw notFound();
    const [row] = await tx
      .select()
      .from(evictionTeamChatOperations)
      .where(eq(evictionTeamChatOperations.id, id));
    if (row.finalized) return operationDto(row, tx);
    if (row.action === 'open') await verifyFrozenOperation(row, tx);
    else {
      const outcome = await changeCollaborator(
        {
          caseId: row.caseId,
          actorOxyUserId: actor,
          oxyUserId: row.subjectOxyUserId!,
          add: row.action === 'add',
          teamOperationId: id,
        },
        tx,
      );
      if (outcome !== 'ok') throw unavailable();
    }
    const [finalized] = await tx
      .update(evictionTeamChatOperations)
      .set({ finalized: true })
      .where(eq(evictionTeamChatOperations.id, id))
      .returning();
    return operationDto(finalized, tx);
  });
}
export async function teamChatUrl(caseId: string, actor: string) {
  return getDb().transaction(async (tx) => {
    const owner = await lockCase(caseId, tx);
    if (!owner || !(await canEditCase(caseId, actor, tx))) throw notFound();
    if (owner.oxyUserId === actor)
      return `https://allo.you/homiio-team?caseId=${encodeURIComponent(caseId)}`;
    const chat = await findTeamChat(caseId, tx);
    if (!chat) throw unavailable();
    const snapshot = await new AlloTeamAccessClient().snapshot(
      openTeamReference(caseId, chat.referenceCiphertext),
    );
    if (
      !snapshot ||
      snapshot.sourceReference !== caseId ||
      !snapshot.memberAccountIds.includes(actor)
    )
      throw unavailable();
    return `https://allo.you/c/${encodeURIComponent(snapshot.conversationId)}`;
  });
}
