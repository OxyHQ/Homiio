import { api, ApiResponse } from '@/utils/api';
import { imageUploadService } from '@/services/imageUploadService';
import {
  Lease,
  CreateLeaseData,
  UpdateLeaseData,
  LeaseStatus,
  LeasePayment,
  LeasePaymentType,
  LeaseDocument,
  LeaseDocumentType,
} from '@homiio/shared-types';

// Re-export the lease contract types so existing consumers keep a single import site.
export type { Lease, CreateLeaseData, UpdateLeaseData, LeasePayment, LeaseDocument };
export { LeaseStatus };

export interface LeaseFilters {
  status?: string;
  propertyId?: string;
  page?: number;
  limit?: number;
}

export interface LeaseListResponse {
  leases: Lease[];
  total: number;
  page: number;
  totalPages: number;
}

export interface LeasePaymentListResponse {
  payments: LeasePayment[];
  total: number;
  page: number;
  totalPages: number;
}

export interface CreateLeasePaymentData {
  dueDate: string;
  amount: number;
  type: LeasePaymentType;
  description?: string;
}

export interface TerminateLeaseData {
  reason?: string;
  effectiveDate?: string;
}

export interface RenewLeaseData {
  newEndDate: string;
  startDate?: string;
  monthlyRent?: number;
}

export interface UploadLeaseDocumentInput {
  /** Local file URI (native path or web blob/object URL). */
  uri: string;
  name: string;
  type?: LeaseDocumentType;
}

interface BackendLease extends Omit<Lease, 'id'> {
  _id?: string;
  id?: string;
}

const normalizeLease = (raw: BackendLease): Lease => ({
  ...(raw as Lease),
  id: raw.id ?? raw._id ?? '',
});

const LEASE_BASE = '/api/leases';

class LeaseService {
  async getLeases(filters?: LeaseFilters): Promise<LeaseListResponse> {
    const response = await api.get<{
      data?: BackendLease[];
      pagination?: { total: number; page: number; totalPages: number };
    }>(LEASE_BASE, { params: filters });
    const leases = (response.data.data ?? []).map(normalizeLease);
    const pagination = response.data.pagination;
    return {
      leases,
      total: pagination?.total ?? leases.length,
      page: pagination?.page ?? 1,
      totalPages: pagination?.totalPages ?? 1,
    };
  }

  async getLease(leaseId: string): Promise<Lease> {
    const response = await api.get<ApiResponse<BackendLease>>(`${LEASE_BASE}/${leaseId}`);
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Lease not found');
    }
    return normalizeLease(response.data.data);
  }

  async createLease(data: CreateLeaseData): Promise<Lease> {
    const response = await api.post<ApiResponse<BackendLease>>(LEASE_BASE, data);
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Lease creation failed');
    }
    return normalizeLease(response.data.data);
  }

  /**
   * Landlord bridge: create a draft lease from an approved tenant application.
   * The backend resolves all owner ids and lifecycle fields server-side.
   */
  async createLeaseFromApplication(applicationId: string): Promise<Lease> {
    const response = await api.post<ApiResponse<BackendLease>>(
      `/api/applications/${applicationId}/create-lease`,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not create lease from application');
    }
    return normalizeLease(response.data.data);
  }

  async updateLease(leaseId: string, data: UpdateLeaseData): Promise<Lease> {
    const response = await api.put<ApiResponse<BackendLease>>(`${LEASE_BASE}/${leaseId}`, data);
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Lease update failed');
    }
    return normalizeLease(response.data.data);
  }

  async deleteLease(leaseId: string): Promise<void> {
    await api.delete(`${LEASE_BASE}/${leaseId}`);
  }

  async signLease(leaseId: string, signature: string, acceptTerms: boolean): Promise<Lease> {
    const response = await api.post<ApiResponse<BackendLease>>(`${LEASE_BASE}/${leaseId}/sign`, {
      signature,
      acceptTerms,
    });
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Lease signing failed');
    }
    return normalizeLease(response.data.data);
  }

  async terminateLease(leaseId: string, data: TerminateLeaseData): Promise<Lease> {
    const response = await api.post<ApiResponse<BackendLease>>(
      `${LEASE_BASE}/${leaseId}/terminate`,
      data,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Lease termination failed');
    }
    return normalizeLease(response.data.data);
  }

  async renewLease(leaseId: string, data: RenewLeaseData): Promise<Lease> {
    const response = await api.post<ApiResponse<BackendLease>>(
      `${LEASE_BASE}/${leaseId}/renew`,
      data,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Lease renewal failed');
    }
    return normalizeLease(response.data.data);
  }

  async getLeasePayments(
    leaseId: string,
    filters?: { status?: string; page?: number; limit?: number },
  ): Promise<LeasePaymentListResponse> {
    const response = await api.get<{
      data?: LeasePayment[];
      pagination?: { total: number; page: number; totalPages: number };
    }>(`${LEASE_BASE}/${leaseId}/payments`, { params: filters });
    const payments = response.data.data ?? [];
    const pagination = response.data.pagination;
    return {
      payments,
      total: pagination?.total ?? payments.length,
      page: pagination?.page ?? 1,
      totalPages: pagination?.totalPages ?? 1,
    };
  }

  async createPayment(leaseId: string, data: CreateLeasePaymentData): Promise<LeasePayment> {
    const response = await api.post<ApiResponse<LeasePayment>>(
      `${LEASE_BASE}/${leaseId}/payments`,
      data,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Payment creation failed');
    }
    return response.data.data;
  }

  async getLeaseDocuments(leaseId: string): Promise<LeaseDocument[]> {
    const response = await api.get<ApiResponse<LeaseDocument[]>>(
      `${LEASE_BASE}/${leaseId}/documents`,
    );
    return response.data.data ?? [];
  }

  /**
   * Attach a document to a lease. The file is first uploaded to the images API,
   * then only its metadata (`name`, `url`, `type`) is persisted on the lease —
   * the lease endpoint stores metadata, not raw file bytes.
   */
  async uploadLeaseDocument(
    leaseId: string,
    input: UploadLeaseDocumentInput,
  ): Promise<LeaseDocument> {
    const uploaded = await imageUploadService.uploadSingleImage(input.uri, 'leases/documents');
    const url = uploaded.urls.original;
    const response = await api.post<ApiResponse<LeaseDocument>>(
      `${LEASE_BASE}/${leaseId}/documents`,
      {
        name: input.name,
        url,
        type: input.type ?? 'other',
      },
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Document upload failed');
    }
    return response.data.data;
  }
}

export const leaseService = new LeaseService();
export default leaseService;
