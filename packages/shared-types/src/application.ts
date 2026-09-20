/**
 * Tenant application types shared across Homiio frontend and backend.
 *
 * A `TenantApplication` is part of the LONG-TERM rent flow (Idealista-style):
 * after viewing a property, a prospective tenant submits an application
 * with income, references and documents for the landlord to review.
 *
 * It is DISTINCT from a `Reservation` (vacation booking) and from a
 * `ViewingRequest` (in-person tour scheduling).
 */

import { EmploymentStatus, ISODate, ReferenceRelationship } from './common';

export enum TenantApplicationStatus {
  SUBMITTED = 'submitted',
  REVIEWING = 'reviewing',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn'
}

import type { DocumentVerificationStatus } from './applicationChecklist';

export enum TenantApplicationDocumentType {
  ID = 'id',
  INCOME = 'income',
  REFERENCE = 'reference',
  OTHER = 'other'
}

/**
 * The same four values as a TUPLE.
 *
 * The enum cannot be iterated or used to build a CHECK, and two places need to:
 * `tenant_application_documents.type` and the per-property requirement list on
 * `properties`. Those two tables import each other, so the tuple cannot live in
 * either schema file without a cycle — it lives here, beside the enum it
 * mirrors, and both import it.
 */
export const TENANT_APPLICATION_DOCUMENT_TYPE_VALUES = [
  'id',
  'income',
  'reference',
  'other',
] as const satisfies readonly `${TenantApplicationDocumentType}`[];

export interface TenantApplicationReference {
  name: string;
  relationship: ReferenceRelationship;
  phone: string;
  email: string;
}

export interface TenantApplicationDocument {
  /** The row's own id, which the download path names. */
  id: string;
  type: TenantApplicationDocumentType;
  /**
   * Where to ASK for the bytes — a Homiio API path, not a link to an object.
   *
   * `url` is gone from this shape on purpose. It held
   * `<publicUrl>/api/images/file/<key>`: the unauthenticated route that also
   * serves listing photos, delivered with a year of `public` cache. Every
   * reader of an application therefore received a permanent, shareable link to
   * somebody's identity document or payslip, and the objects — which live in a
   * private bucket — were reachable for exactly that reason.
   *
   * Fetching this path requires the session, and the handler behind it proves
   * the viewer is the applicant or the landlord before a byte moves. It is not
   * something `Linking.openURL` can open: see
   * `utils/privateDocument.ts` on the client.
   */
  downloadPath: string;
  filename: string;
  /**
   * Where the landlord stands on this document.
   *
   * A stored decision, written only by the landlord through
   * `POST /api/applications/:id/documents/:documentId/verification` — §7.4:
   * "Pulsar un botón no convierte localmente un documento en verificado."
   */
  verification: DocumentVerificationStatus;
  /** Present only on a rejection, and required there. */
  rejectionReason?: string;
  verifiedAt?: ISODate;
}

export interface TenantApplication {
  id: string;
  propertyId: string;
  applicantOxyUserId: string;
  landlordOxyUserId: string;
  moveInDate: ISODate;
  /** Desired lease length in months. */
  leaseTermMonths: number;
  /** Self-reported gross monthly income in the listing's currency. */
  monthlyIncome: number;
  employmentStatus: EmploymentStatus;
  referenceContacts: TenantApplicationReference[];
  documents: TenantApplicationDocument[];
  /**
   * What the LISTING asks an applicant for.
   *
   * The checklist's other half: without it a screen can only report what
   * happened to arrive, so nothing is ever missing. Empty means the landlord
   * asked for nothing, not that the field is unknown.
   */
  requiredDocuments: TenantApplicationDocumentType[];
  status: TenantApplicationStatus;
  notes?: string;
  submittedAt: ISODate;
  decidedAt?: ISODate;
}

export interface CreateTenantApplicationData {
  propertyId: string;
  moveInDate: ISODate;
  leaseTermMonths: number;
  monthlyIncome: number;
  employmentStatus: EmploymentStatus;
  referenceContacts: TenantApplicationReference[];
  documents?: TenantApplicationDocument[];
  notes?: string;
}

export interface UpdateTenantApplicationData {
  status?: TenantApplicationStatus;
  notes?: string;
  documents?: TenantApplicationDocument[];
}
