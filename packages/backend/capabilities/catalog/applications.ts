import {
  DOCUMENT_VERIFICATION_STATUSES,
  TENANT_APPLICATION_DOCUMENT_TYPE_VALUES,
  TenantApplicationStatus,
} from '@homiio/shared-types';
import type { CatalogTool } from '@oxy.so/contracts';

import { REFERENCE_RELATIONSHIPS } from '../../db/schema/profiles';

import {
  actTool,
  booleanInput,
  enumInput,
  idInput,
  isoDateInput,
  limitInput,
  objectInput,
  optionalTextInput,
  pageInput,
  readTool,
  textInput,
} from './define';

const APPLICATION_STATUSES = Object.values(TenantApplicationStatus);
const EMPLOYMENT_STATUSES = [
  'employed',
  'self_employed',
  'student',
  'retired',
  'unemployed',
  'other',
];
/** `domain/applications.ts` ALLOWED_DOCUMENT_MIME_TYPES; equality is asserted in the tests. */
export const APPLICATION_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
];

/** One application document, as a tool sends it. Shared by submit and add. */
const documentInput = objectInput(
  {
    type: enumInput(TENANT_APPLICATION_DOCUMENT_TYPE_VALUES),
    filename: textInput(255),
    mimeType: enumInput(APPLICATION_DOCUMENT_MIME_TYPES),
    contentBase64: {
      type: 'string',
      minLength: 1,
      description: 'The file bytes, base64.',
    },
  },
  ['type', 'filename', 'mimeType', 'contentBase64'],
);

const decisionInput = objectInput({ applicationId: idInput, notes: optionalTextInput(4000) }, [
  'applicationId',
]);

export const APPLICATION_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'listMyApplications',
    description:
      'List the long-term rent applications the person sent (default) or, with asLandlord=true, the ones sent to their listings. Paginated, newest first.',
    capability: 'housing.applications.read',
    input: objectInput({
      page: pageInput,
      limit: limitInput,
      status: enumInput(APPLICATION_STATUSES),
      asLandlord: booleanInput,
    }),
  }),
  readTool({
    name: 'getApplication',
    description:
      "Read one application, with its references and documents' metadata and verification state. Only its applicant or its landlord may read it; anybody else is refused.",
    capability: 'housing.applications.read',
    input: objectInput({ applicationId: idInput }, ['applicationId']),
  }),
  actTool({
    name: 'submitApplication',
    description:
      "Apply to rent a listing long-term, as the person. Documents (ID, income proof, references) are sent as base64 files and stored privately, exactly like an upload from the app. Refused for the person's own listing, a listing not offered for long-term rent, or a second active application to the same listing. An external listing (published on another website) never takes an application: the result is { status: 'external_listing', sourceUrl } and the person applies on that page.",
    capability: 'housing.applications.submit',
    capabilityPackage: 'communicate',
    input: objectInput(
      {
        propertyId: idInput,
        moveInDate: isoDateInput,
        leaseTermMonths: { type: 'integer', minimum: 1, maximum: 120 },
        monthlyIncome: { type: 'number', minimum: 0 },
        employmentStatus: enumInput(EMPLOYMENT_STATUSES),
        notes: optionalTextInput(4000),
        referenceContacts: {
          type: 'array',
          maxItems: 10,
          items: objectInput(
            {
              name: textInput(200),
              relationship: enumInput(REFERENCE_RELATIONSHIPS),
              phone: textInput(50),
              email: textInput(254),
            },
            ['name', 'relationship', 'phone', 'email'],
          ),
        },
        documents: {
          type: 'array',
          maxItems: 10,
          description:
            'Up to 10 files of at most 10 MB each. One call, base64 included, carries at most 10 MB in all; send the rest with addApplicationDocuments.',
          items: documentInput,
        },
      },
      ['propertyId', 'moveInDate', 'leaseTermMonths', 'monthlyIncome', 'employmentStatus'],
    ),
  }),
  actTool({
    name: 'addApplicationDocuments',
    description:
      'Attach more documents (ID, income proof, references) to an application the person sent, while it is still submitted or under review — the ones that did not fit in submitApplication, or ones the landlord asked for later. Stored privately, like an upload from the app. Only its applicant may add them, and an application holds at most 10 documents in all.',
    capability: 'housing.applications.submit',
    capabilityPackage: 'communicate',
    input: objectInput(
      {
        applicationId: idInput,
        documents: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          description:
            'Files of at most 10 MB each; one call, base64 included, carries at most 10 MB in all.',
          items: documentInput,
        },
      },
      ['applicationId', 'documents'],
    ),
  }),
  actTool({
    name: 'withdrawApplication',
    description:
      'Withdraw an application the person sent, while it is still submitted or under review. Only its applicant may withdraw it.',
    capability: 'housing.applications.submit',
    capabilityPackage: 'administer',
    input: decisionInput,
  }),
  actTool({
    name: 'startReviewingApplication',
    description:
      "Mark an application to one of the person's listings as under review. Landlord only, while it is still pending.",
    capability: 'housing.applications.decide',
    capabilityPackage: 'administer',
    input: decisionInput,
  }),
  actTool({
    name: 'acceptApplication',
    description:
      "Approve an application to one of the person's listings. Landlord only, while it is still pending. An approved application can then become a draft lease with createLeaseFromApplication.",
    capability: 'housing.applications.decide',
    capabilityPackage: 'administer',
    input: decisionInput,
  }),
  actTool({
    name: 'rejectApplication',
    description:
      "Reject an application to one of the person's listings. Landlord only, while it is still pending.",
    capability: 'housing.applications.decide',
    capabilityPackage: 'administer',
    input: decisionInput,
  }),
  actTool({
    name: 'verifyApplicationDocument',
    description:
      "As the landlord, mark one document of an application as verified, rejected (a reason is required) or back to pending. The only way a document becomes verified. Someone else's application answers not-found.",
    capability: 'housing.applications.decide',
    capabilityPackage: 'administer',
    input: objectInput(
      {
        applicationId: idInput,
        documentId: idInput,
        status: enumInput(DOCUMENT_VERIFICATION_STATUSES),
        reason: optionalTextInput(500),
      },
      ['applicationId', 'documentId', 'status'],
    ),
  }),
  actTool({
    name: 'createLeaseFromApplication',
    description:
      "Turn an APPROVED application to one of the person's listings into a draft lease, with terms from the application and rent from the listing. The only way a lease is created. Landlord only; refused when the application is not approved or the tenant already has a lease for that home.",
    capability: 'housing.leases.manage',
    capabilityPackage: 'create',
    input: objectInput({ applicationId: idInput }, ['applicationId']),
  }),
];
