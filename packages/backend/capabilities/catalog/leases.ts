import { LeaseStatus } from '@homiio/shared-types';
import type { CatalogTool } from '@oxy.so/contracts';

import { LEASE_DOCUMENT_TYPES } from '../../db/schema/leases';

import {
  actTool,
  enumInput,
  idInput,
  isoDateInput,
  limitInput,
  objectInput,
  openObjectInput,
  optionalTextInput,
  pageInput,
  readTool,
  textInput,
} from './define';

const LEASE_STATUSES = Object.values(LeaseStatus);
/** `domain/leases.ts` LEASE_DOCUMENT_MIME_TYPES; equality is asserted in the tests. */
export const LEASE_DOCUMENT_TOOL_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

const leaseIdInput = objectInput({ leaseId: idInput }, ['leaseId']);

export const LEASE_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'listMyLeases',
    description:
      'List the leases the person is a party to (as landlord, tenant or co-tenant), newest first, optionally filtered by status or listing.',
    capability: 'housing.leases.read',
    input: objectInput({
      page: pageInput,
      limit: limitInput,
      status: enumInput(LEASE_STATUSES),
      propertyId: idInput,
    }),
  }),
  readTool({
    name: 'getLease',
    description:
      'Read one lease with its timeline and signature records, including the termsSha256 to sign against. Parties only; anybody else is refused.',
    capability: 'housing.leases.read',
    input: leaseIdInput,
  }),
  actTool({
    name: 'updateLease',
    description:
      'Edit a draft (or awaiting-signatures) lease as its landlord. Only these fields of `changes` are applied: tenantOxyUserId, roomId, coTenants, leaseTerms, rentDetails, utilities, rules, notes; anything else is ignored. Refused once the lease is signed, active or closed.',
    capability: 'housing.leases.manage',
    capabilityPackage: 'administer',
    input: objectInput(
      {
        leaseId: idInput,
        changes: openObjectInput(
          'The lease fields to change, in the same shape getLease returns them.',
        ),
      },
      ['leaseId', 'changes'],
    ),
  }),
  actTool({
    name: 'deleteLease',
    description:
      'Delete a draft (or awaiting-signatures) lease as its landlord, with its schedule and documents. Refused for a signed, active or closed lease.',
    capability: 'housing.leases.manage',
    capabilityPackage: 'administer',
    input: leaseIdInput,
  }),
  actTool({
    name: 'signLease',
    description:
      'Sign a lease as whichever party the person is on it (landlord, tenant or co-tenant). Pass the termsSha256 from getLease: if the terms changed since, the signature is refused (LEASE_TERMS_CHANGED) so the person can review the new ones. The lease becomes active once every party has signed.',
    capability: 'housing.leases.sign',
    capabilityPackage: 'administer',
    input: objectInput(
      {
        leaseId: idInput,
        acceptTerms: { type: 'boolean', enum: [true], description: 'Must be true.' },
        termsSha256: { type: 'string', minLength: 64, maxLength: 64 },
      },
      ['leaseId', 'acceptTerms'],
    ),
  }),
  actTool({
    name: 'terminateLease',
    description:
      'Serve a termination notice on a lease the person is a party to, effective on a date (default now), with an optional reason. Refused when already terminated.',
    capability: 'housing.leases.manage',
    capabilityPackage: 'administer',
    input: objectInput(
      { leaseId: idInput, effectiveDate: isoDateInput, reason: optionalTextInput(2000) },
      ['leaseId'],
    ),
  }),
  actTool({
    name: 'renewLease',
    description:
      'Renew a lease as its landlord: creates a new DRAFT lease inheriting its terms with a new end date (and optionally a new start date and monthly rent). Every party signs the renewal again.',
    capability: 'housing.leases.manage',
    capabilityPackage: 'create',
    input: objectInput(
      {
        leaseId: idInput,
        newEndDate: isoDateInput,
        startDate: isoDateInput,
        monthlyRent: { type: 'number', minimum: 0 },
      },
      ['leaseId', 'newEndDate'],
    ),
  }),
  readTool({
    name: 'listLeaseDocuments',
    description:
      "List a lease's documents (name, type, who uploaded it, when) — metadata only. Parties only.",
    capability: 'housing.leases.read',
    input: leaseIdInput,
  }),
  actTool({
    name: 'uploadLeaseDocument',
    description:
      'Attach a document (PDF or photo, at most 10 MB, base64) to a lease the person is a party to. Stored privately, exactly like an upload from the app.',
    capability: 'housing.leases.manage',
    capabilityPackage: 'create',
    input: objectInput(
      {
        leaseId: idInput,
        type: enumInput(LEASE_DOCUMENT_TYPES),
        name: optionalTextInput(120),
        filename: textInput(255),
        mimeType: enumInput(LEASE_DOCUMENT_TOOL_MIME_TYPES),
        contentBase64: { type: 'string', minLength: 1, description: 'The file bytes, base64.' },
      },
      ['leaseId', 'filename', 'mimeType', 'contentBase64'],
    ),
  }),
];
