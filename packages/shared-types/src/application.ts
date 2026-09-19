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

export enum TenantApplicationDocumentType {
  ID = 'id',
  INCOME = 'income',
  REFERENCE = 'reference',
  OTHER = 'other'
}

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
