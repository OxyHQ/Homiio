import {
  type ActingFor,
  type ExternalMcpDocumentProof,
  getOxyActor,
  getOxyUserId,
  type OxyAuthRequest,
} from '@oxy.so/core/server';
import type { Request } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { oxyFiles } from './oxyFilesClient';

/**
 * Who a person's document is stored for in their Oxy files.
 *
 * - `own`: Homiio itself, acting for the account (oxy ADR 0066). Homiio's entry
 *   in oxy's first-party registry declares `oxy:files` write; Oxy checks the
 *   accounts live. No session, task or ticket goes with it.
 * - `external`: an external MCP connection's own proof (the OAuth lane), which
 *   stays a third-party grant.
 */
export type DocumentRequester =
  | { kind: 'own'; actingFor: ActingFor }
  | { kind: 'external'; proof: ExternalMcpDocumentProof };

/**
 * The account a signed-in person's request acts on, and that person when they
 * operate the account (an organization) rather than own it. Only a person's own
 * session: a service acting as someone (including a third party's delegated
 * token) never becomes Homiio's own authority over their files.
 */
export function sessionActingFor(req: Request): ActingFor | undefined {
  if ((req as OxyAuthRequest).serviceActingAs) return undefined;
  const accountId = getOxyUserId(req);
  if (!accountId) return undefined;
  const actorAccountId = getOxyActor(req)?.actorAccountId;
  return actorAccountId && actorAccountId !== accountId
    ? { accountId, requesterAccountId: actorAccountId }
    : { accountId };
}

export function sessionFileRequester(req: Request): DocumentRequester | undefined {
  const actingFor = sessionActingFor(req);
  return actingFor ? { kind: 'own', actingFor } : undefined;
}

/** An owner id alone never becomes authority: it must be the account the requester acts for. */
export function personalDocumentFiles(requester: DocumentRequester | undefined, accountId: string) {
  if (!requester)
    throw new AppError('The upload requires its original requester', 403, 'REQUESTER_REQUIRED');
  if (requester.kind === 'external')
    return oxyFiles().withMcpDocumentRequester({ ...requester.proof, accountId });
  if (requester.actingFor.accountId !== accountId)
    throw new AppError('The upload requires its original requester', 403, 'REQUESTER_REQUIRED');
  return oxyFiles().actingFor(requester.actingFor);
}
