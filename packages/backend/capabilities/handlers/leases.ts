/**
 * Lease tools → `domain/leases.ts`, as the effective account.
 *
 * Outputs are the routes' bodies minus `success`/`message`/`meta`. Where the
 * route validates in middleware (`validateLeaseListQuery`, `validateLeaseId`,
 * `validateLeaseUpdate`) the handler runs the same chain first. A lease is
 * never created here directly: `createLeaseFromApplication` (applications) is
 * the one entry point.
 */

import {
  deleteLease,
  getLease,
  leaseDocumentFileFromBase64,
  listLeaseDocuments,
  listMyLeases,
  renewLease,
  signLease,
  terminateLease,
  updateLease,
  uploadLeaseDocument,
} from '../../domain/leases';
import * as validation from '../../middlewares/validation';
import {
  asQuery,
  type HomiioToolHandlers,
  optionalString,
  requiredObject,
  requiredString,
} from './context';
import { runRouteValidation } from './routeValidation';
import { dataBody, pageBody } from './tenancyBody';

async function leaseIdOf(input: Readonly<Record<string, unknown>>): Promise<string> {
  const leaseId = requiredString(input, 'leaseId');
  await runRouteValidation(validation.validateLeaseId, { params: { id: leaseId } });
  return leaseId;
}

export const LEASE_HANDLERS: HomiioToolHandlers = {
  listMyLeases: async (input, { accountId }) => {
    await runRouteValidation(validation.validateLeaseListQuery, { query: asQuery(input) });
    const result = await listMyLeases(accountId, {
      page: input.page,
      limit: input.limit,
      status: input.status,
      propertyId: input.propertyId,
    });
    return pageBody(result.leases, result.page, result.limit, result.total);
  },

  getLease: async (input, { accountId }) =>
    dataBody(await getLease(accountId, await leaseIdOf(input))),

  updateLease: async (input, { accountId }) => {
    const leaseId = requiredString(input, 'leaseId');
    const changes = requiredObject(input, 'changes');
    await runRouteValidation(validation.validateLeaseUpdate, {
      params: { id: leaseId },
      body: changes,
    });
    return dataBody(await updateLease(accountId, leaseId, changes));
  },

  deleteLease: async (input, { accountId }) =>
    dataBody(await deleteLease(accountId, await leaseIdOf(input))),

  signLease: async (input, { accountId }) =>
    dataBody(
      await signLease(accountId, await leaseIdOf(input), {
        acceptTerms: input.acceptTerms,
        termsSha256: optionalString(input, 'termsSha256'),
      }),
    ),

  terminateLease: async (input, { accountId }) =>
    dataBody(
      await terminateLease(accountId, await leaseIdOf(input), {
        reason: input.reason,
        effectiveDate: input.effectiveDate,
      }),
    ),

  renewLease: async (input, { accountId }) =>
    dataBody(
      await renewLease(accountId, await leaseIdOf(input), {
        newEndDate: input.newEndDate,
        startDate: input.startDate,
        monthlyRent: input.monthlyRent,
      }),
    ),

  listLeaseDocuments: async (input, { accountId }) =>
    dataBody(await listLeaseDocuments(accountId, await leaseIdOf(input))),

  uploadLeaseDocument: async (input, { accountId }) => {
    const leaseId = await leaseIdOf(input);
    const file = leaseDocumentFileFromBase64({
      filename: requiredString(input, 'filename'),
      mimeType: requiredString(input, 'mimeType'),
      contentBase64: requiredString(input, 'contentBase64'),
    });
    return dataBody(
      await uploadLeaseDocument(accountId, leaseId, { file, type: input.type, name: input.name }),
    );
  },
};
