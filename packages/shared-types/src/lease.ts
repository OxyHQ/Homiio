/**
 * Lease-related types shared across Homiio frontend and backend
 */


import { Property } from './property';
import { Profile } from './profile';

export enum LeaseStatus {
  DRAFT = 'draft',
  PENDING_SIGNATURE = 'pending_signature',
  PARTIALLY_SIGNED = 'partially_signed',
  FULLY_SIGNED = 'fully_signed',
  ACTIVE = 'active',
  TERMINATED = 'terminated',
  EXPIRED = 'expired'
}

export enum PaymentMethod {
  BANK_TRANSFER = 'bank_transfer',
  FAIRCOIN = 'faircoin',
  CREDIT_CARD = 'credit_card',
  CASH = 'cash'
}

export enum PetPolicy {
  ALLOWED = 'allowed',
  NOT_ALLOWED = 'not_allowed',
  CASE_BY_CASE = 'case_by_case'
}

export enum SmokingPolicy {
  ALLOWED = 'allowed',
  NOT_ALLOWED = 'not_allowed',
  OUTSIDE_ONLY = 'outside_only'
}

export enum MaintenanceResponsibility {
  LANDLORD = 'landlord',
  TENANT = 'tenant',
  SHARED = 'shared'
}

export interface LeaseRent {
  amount: number;
  currency: string;
  dueDay: number;
  paymentMethod: PaymentMethod;
  lateFee?: {
    amount: number;
    gracePeriod: number;
  };
}

export interface LeaseDeposit {
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'refunded';
  paidAt?: string;
}

export interface LeaseTerms {
  duration: number; // months
  noticePeriod: number; // days
  petPolicy: PetPolicy;
  smokingPolicy: SmokingPolicy;
  maintenanceResponsibility: MaintenanceResponsibility;
  utilitiesIncluded?: string[];
  additionalTerms?: string[];
}

export interface LeaseSignature {
  signedAt: string;
  ipAddress: string;
  signature?: string;
}

export interface LeaseSignatures {
  landlord?: LeaseSignature;
  tenant?: LeaseSignature;
}

export interface LeaseDocument {
  id: string;
  name: string;
  url: string;
  type: 'lease' | 'inspection' | 'insurance' | 'other';
  uploadedAt: string;
  uploadedBy: string;
}

export interface Lease {
  id: string;
  propertyId: string;
  property?: Property;
  landlordId: string;
  landlord?: Profile;
  tenantId: string;
  tenant?: Profile;
  status: LeaseStatus;
  startDate: string;
  endDate: string;
  rent: LeaseRent;
  deposit: LeaseDeposit;
  terms: LeaseTerms;
  signatures: LeaseSignatures;
  documents?: LeaseDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeaseData {
  propertyId: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  rent: LeaseRent;
  deposit: LeaseDeposit;
  terms: LeaseTerms;
}

export interface UpdateLeaseData {
  status?: LeaseStatus;
  rent?: Partial<LeaseRent>;
  deposit?: Partial<LeaseDeposit>;
  terms?: Partial<LeaseTerms>;
  signatures?: Partial<LeaseSignatures>;
} 