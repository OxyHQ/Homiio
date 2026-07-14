/**
 * Lease-related types shared across Homiio frontend and backend.
 *
 * The Mongoose `Lease` schema (`packages/backend/models/schemas/LeaseSchema.ts`)
 * and the `toLeaseDTO` serializer are the single authority for this shape. These
 * interfaces mirror that authority: owner references are session `landlordOxyUserId` /
 * `tenantOxyUserId`, terms live under `leaseTerms`, money under `rentDetails`,
 * and `status` uses the schema enum (`pending_signatures`, plural). There is no
 * legacy flat shape.
 */

import { Property } from './property';
import { Profile } from './profile';

export enum LeaseStatus {
  DRAFT = 'draft',
  PENDING_SIGNATURES = 'pending_signatures',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  TERMINATED = 'terminated',
  CANCELLED = 'cancelled',
}

/** Currency codes accepted by the lease `rentDetails` block. */
export type LeaseCurrency = 'USD' | 'EUR' | 'GBP' | 'CAD';

export interface LeaseTerms {
  startDate: string;
  endDate: string;
  renewalOptions?: 'none' | 'automatic' | 'optional';
  renewalNoticeRequired?: number;
  terminationNoticeRequired?: number;
}

export interface LeaseRentDetails {
  monthlyRent: number;
  currency: LeaseCurrency;
  dueDate?: number;
  lateFee?: {
    amount: number;
    gracePeriod: number;
  };
  securityDeposit?: number;
  petDeposit?: number;
}

export interface LeaseSignature {
  signed: boolean;
  signedDate?: string;
  digitalSignature?: string;
}

export interface LeaseSignatures {
  landlord: LeaseSignature;
  tenant: LeaseSignature;
}

export interface LeaseCoTenant {
  oxyUserId: string;
  role?: 'primary' | 'secondary' | 'guarantor';
  signedDate?: string;
  status?: 'pending' | 'signed' | 'declined';
}

export type LeasePaymentType = 'rent' | 'deposit' | 'fee' | 'utility';
export type LeasePaymentStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

export interface LeasePayment {
  id: string;
  dueDate: string;
  amount: number;
  type: LeasePaymentType;
  description?: string;
  status: LeasePaymentStatus;
  paidDate?: string;
  paidAmount?: number;
  paymentMethod?: string;
  transactionId?: string;
}

export type LeaseDocumentType =
  | 'lease_agreement'
  | 'addendum'
  | 'inspection_report'
  | 'insurance'
  | 'other';

export interface LeaseDocument {
  id: string;
  name: string;
  url: string;
  type: LeaseDocumentType;
  uploadedBy: string;
  uploadedDate: string;
}

export interface Lease {
  id: string;
  propertyId: string;
  property?: Property;
  roomId?: string;
  landlordOxyUserId: string;
  landlord?: Profile;
  tenantOxyUserId: string;
  tenant?: Profile;
  coTenants?: LeaseCoTenant[];
  status: LeaseStatus;
  leaseTerms: LeaseTerms;
  rentDetails: LeaseRentDetails;
  signatures: LeaseSignatures;
  documents?: LeaseDocument[];
  paymentSchedule?: LeasePayment[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeaseData {
  propertyId: string;
  tenantOxyUserId: string;
  roomId?: string;
  leaseTerms: LeaseTerms;
  rentDetails: LeaseRentDetails;
  coTenants?: LeaseCoTenant[];
}

export interface UpdateLeaseData {
  tenantOxyUserId?: string;
  roomId?: string;
  leaseTerms?: Partial<LeaseTerms>;
  rentDetails?: Partial<LeaseRentDetails>;
  coTenants?: LeaseCoTenant[];
  notes?: string;
}
