/**
 * Application tools → `domain/applications.ts`, as the effective account.
 *
 * Outputs are the routes' bodies minus `success`/`message`/`meta`.
 * `submitApplication` runs the route's `validateTenantApplication` chain first
 * and decodes base64 documents into the file objects multer would have
 * produced, so they go through the same upload path.
 */

import {
  changeApplicationStatus,
  createLeaseFromApplication,
  documentFileFromBase64,
  getApplication,
  listMyApplications,
  submitApplication,
  verifyApplicationDocument,
} from '../../domain/applications';
import { TenantApplicationStatus } from '@homiio/shared-types';
import * as validation from '../../middlewares/validation';
import { type HomiioToolHandlers, type ToolInput, optionalString, requiredString } from './context';
import { runRouteValidation } from './routeValidation';
import { dataBody, pageBody } from './tenancyBody';

function decide(status: TenantApplicationStatus) {
  return async (input: ToolInput, { accountId }: { accountId: string }) =>
    dataBody(
      await changeApplicationStatus(accountId, requiredString(input, 'applicationId'), {
        status,
        notes: optionalString(input, 'notes'),
      }),
    );
}

interface DocumentInput {
  type: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
}

export const APPLICATION_HANDLERS: HomiioToolHandlers = {
  listMyApplications: async (input, { accountId }) => {
    const result = await listMyApplications(accountId, {
      page: input.page,
      limit: input.limit,
      status: input.status,
      asLandlord: input.asLandlord === true ? 'true' : undefined,
    });
    return pageBody(result.applications, result.page, result.limit, result.total);
  },

  getApplication: async (input, { accountId }) =>
    dataBody(await getApplication(accountId, requiredString(input, 'applicationId'))),

  submitApplication: async (input, { accountId }) => {
    const body: Record<string, unknown> = { ...input };
    delete body.documents;
    await runRouteValidation(validation.validateTenantApplication, { body });

    const documents = (Array.isArray(input.documents) ? input.documents : []) as DocumentInput[];
    const files = documents.map(documentFileFromBase64);
    const outcome = await submitApplication(accountId, {
      propertyId: input.propertyId,
      moveInDate: input.moveInDate,
      leaseTermMonths: input.leaseTermMonths,
      monthlyIncome: input.monthlyIncome,
      employmentStatus: input.employmentStatus,
      notes: input.notes,
      referenceContacts: input.referenceContacts,
      documentTypes: documents.map((document) => document.type),
      files,
    });
    if (outcome.kind === 'external_listing') return { ...outcome.outcome };
    return dataBody(outcome.application);
  },

  withdrawApplication: decide(TenantApplicationStatus.WITHDRAWN),
  startReviewingApplication: decide(TenantApplicationStatus.REVIEWING),
  acceptApplication: decide(TenantApplicationStatus.APPROVED),
  rejectApplication: decide(TenantApplicationStatus.REJECTED),

  verifyApplicationDocument: async (input, { accountId }) =>
    dataBody(
      await verifyApplicationDocument(accountId, {
        applicationId: requiredString(input, 'applicationId'),
        documentId: requiredString(input, 'documentId'),
        status: input.status,
        reason: input.reason,
      }),
    ),

  createLeaseFromApplication: async (input, { accountId }) =>
    dataBody(await createLeaseFromApplication(accountId, requiredString(input, 'applicationId'))),
};
