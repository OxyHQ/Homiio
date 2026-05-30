import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/core';
import {
  Lease,
  LeaseTerms,
  CreateLeaseData,
  UpdateLeaseData,
  LeaseStatus,
  PaymentMethod,
  PetPolicy,
  SmokingPolicy,
  MaintenanceResponsibility,
} from '@homiio/shared-types';

// Re-export the types for backward compatibility
export type { Lease, CreateLeaseData, UpdateLeaseData };

// Re-export enums for backward compatibility
export { LeaseStatus, PaymentMethod, PetPolicy, SmokingPolicy, MaintenanceResponsibility };

export interface LeaseFilters {
  status?: string;
  propertyId?: string;
  page?: number;
  limit?: number;
}

export interface Payment {
  id: string;
  leaseId: string;
  type: 'rent' | 'deposit' | 'late_fee' | 'utility' | 'maintenance';
  amount: number;
  currency: string;
  dueDate: string;
  paidAt?: string;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  paymentMethod: 'bank_transfer' | 'faircoin' | 'credit_card' | 'cash';
  reference?: string;
}

export interface CreatePaymentData {
  type: 'rent' | 'deposit' | 'late_fee' | 'utility' | 'maintenance';
  amount: number;
  currency: string;
  dueDate: string;
  paymentMethod: 'bank_transfer' | 'faircoin' | 'credit_card' | 'cash';
}

export interface LeaseDocument {
  id: string;
  leaseId: string;
  type: 'lease_agreement' | 'move_in_checklist' | 'move_out_checklist' | 'amendment' | 'other';
  filename: string;
  size: number;
  description?: string;
  uploadedBy: string;
  uploadedAt: string;
  downloadUrl: string;
}

class LeaseService {
  private baseUrl = '/api/leases';

  async getLeases(
    filters?: LeaseFilters,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<{
    leases: Lease[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await api.get(this.baseUrl, {
      params: filters,
    });
    return response.data;
  }

  async getLease(
    leaseId: string,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<Lease> {
    const response = await api.get(`${this.baseUrl}/${leaseId}`);
    return response.data.data;
  }

  async createLease(
    data: CreateLeaseData,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<Lease> {
    const response = await api.post(this.baseUrl, data);
    return response.data.data;
  }

  async updateLease(
    leaseId: string,
    data: Partial<CreateLeaseData>,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<Lease> {
    const response = await api.put(`${this.baseUrl}/${leaseId}`, data);
    return response.data.data;
  }

  async deleteLease(
    leaseId: string,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<void> {
    await api.delete(`${this.baseUrl}/${leaseId}`);
  }

  async signLease(
    leaseId: string,
    signature: string,
    acceptTerms: boolean,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<Lease> {
    const response = await api.post(
      `${this.baseUrl}/${leaseId}/sign`,
      {
        signature,
        acceptTerms,
      },
    );
    return response.data.data;
  }

  async terminateLease(
    leaseId: string,
    reason: string,
    terminationDate: string,
    notice?: string,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<void> {
    await api.post(
      `${this.baseUrl}/${leaseId}/terminate`,
      {
        reason,
        terminationDate,
        notice,
      },
    );
  }

  async renewLease(
    leaseId: string,
    data: {
      newStartDate: string;
      newEndDate: string;
      rentIncrease?: number;
      updatedTerms?: Partial<LeaseTerms>;
    },
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<Lease> {
    const response = await api.post(`${this.baseUrl}/${leaseId}/renew`, data);
    return response.data.data;
  }

  async getLeasePayments(
    leaseId: string,
    filters?: {
      status?: string;
      page?: number;
      limit?: number;
    },
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<{
    payments: Payment[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await api.get(`${this.baseUrl}/${leaseId}/payments`, {
      params: filters,
    });
    return response.data;
  }

  async createPayment(
    leaseId: string,
    data: CreatePaymentData,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<Payment> {
    const response = await api.post(`${this.baseUrl}/${leaseId}/payments`, data);
    return response.data.data;
  }

  async getLeaseDocuments(
    leaseId: string,
    _oxyServices?: OxyServices,
    _activeSessionId?: string,
  ): Promise<LeaseDocument[]> {
    const response = await api.get(`${this.baseUrl}/${leaseId}/documents`);
    return response.data.data;
  }

  async uploadLeaseDocument(
    leaseId: string,
    file: File,
    type: string,
    description?: string,
  ): Promise<LeaseDocument> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    if (description) {
      formData.append('description', description);
    }

    const response = await api.post(`${this.baseUrl}/${leaseId}/documents`, formData);
    return response.data.data;
  }

  // Utility methods
  async getActiveLeases(): Promise<Lease[]> {
    const response = await api.get(`${this.baseUrl}/active`);
    return response.data.data;
  }

  async getPendingSignatureLeases(): Promise<Lease[]> {
    const response = await api.get(`${this.baseUrl}/pending-signature`);
    return response.data.data;
  }

  async getUpcomingPayments(leaseId: string): Promise<Payment[]> {
    const response = await api.get(`${this.baseUrl}/${leaseId}/upcoming-payments`);
    return response.data.data;
  }
}

export const leaseService = new LeaseService();
