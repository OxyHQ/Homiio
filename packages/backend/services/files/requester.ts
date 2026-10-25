import type { RequesterProof, ExternalMcpDocumentProof } from '@oxy.so/core/server';
import type { Request } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { oxyFiles } from './oxyFilesClient';

export type DocumentRequester =
  | { kind: 'own'; proof: RequesterProof }
  | { kind: 'external'; proof: ExternalMcpDocumentProof };

export function sessionFileRequester(req: Request): DocumentRequester | undefined {
  return req.accessToken ? { kind: 'own', proof: { requesterToken: req.accessToken } } : undefined;
}

/** Missing provenance cannot become account authority by supplying an owner ID. */
export function personalDocumentFiles(requester: DocumentRequester | undefined, accountId: string) {
  if (!requester)
    throw new AppError('The upload requires its original requester', 403, 'REQUESTER_REQUIRED');
  return requester.kind === 'own'
    ? oxyFiles().withRequester({ ...requester.proof, accountId })
    : oxyFiles().withMcpDocumentRequester({ ...requester.proof, accountId });
}
