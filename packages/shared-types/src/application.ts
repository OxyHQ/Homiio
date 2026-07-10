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
  type: TenantApplicationDocumentType;
  url: string;
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
