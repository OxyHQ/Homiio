import { Platform } from 'react-native';

import { api, ApiError, ApiResponse } from '@/utils/api';
import {
  Lease,
  LeaseStatus,
  LeasePayment,
  LeaseDocument,
  LeaseDocumentType,
} from '@homiio/shared-types';

// Re-export the lease contract types so existing consumers keep a single import site.
// There is deliberately no create/update call here: `/contracts/new?application=<id>`
// (`createLeaseFromApplication`) is the only way a lease is made.
export type { Lease, LeasePayment, LeaseDocument };
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

export interface TerminateLeaseData {
  reason?: string;
  effectiveDate?: string;
}

export interface UploadLeaseDocumentInput {
  /** Local file URI (native path or web blob/object URL). */
  uri: string;
  /** The label the document is filed under. */
  name: string;
  /** The picked file's own name, which carries the extension. */
  filename?: string;
  /** From the picker; `application/pdf` for the ordinary tenancy contract. */
  mimeType?: string;
  /** Web only: the `File` the picker already handed us. */
  file?: File;
  type?: LeaseDocumentType;
}

const LEASE_BASE = '/api/leases';

class LeaseService {
  async getLeases(filters?: LeaseFilters): Promise<LeaseListResponse> {
    const response = await api.get<{
      data?: Lease[];
      pagination?: { total: number; page: number; totalPages: number };
    }>(LEASE_BASE, { params: filters });
    const leases = response.data.data ?? [];
    const pagination = response.data.pagination;
    return {
      leases,
      total: pagination?.total ?? leases.length,
      page: pagination?.page ?? 1,
      totalPages: pagination?.totalPages ?? 1,
    };
  }

  async getLease(leaseId: string): Promise<Lease> {
    const response = await api.get<ApiResponse<Lease>>(`${LEASE_BASE}/${leaseId}`);
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Lease not found');
    }
    return response.data.data;
  }

  /**
   * Landlord bridge: create a draft lease from an approved tenant application.
   * The backend resolves all owner ids and lifecycle fields server-side.
   */
  async createLeaseFromApplication(applicationId: string): Promise<Lease> {
    const response = await api.post<ApiResponse<Lease>>(
      `/api/applications/${applicationId}/create-lease`,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not create lease from application');
    }
    return response.data.data;
  }

  async deleteLease(leaseId: string): Promise<void> {
    await api.delete(`${LEASE_BASE}/${leaseId}`);
  }

  /**
   * Sign a lease (#518 §7.4).
   *
   * `termsSha256` is the digest the lease response carried — the version this
   * client actually rendered. The server refuses with `409 LEASE_TERMS_CHANGED`
   * if the landlord amended the lease in between, which is what makes "the
   * signature binds to the version shown" true rather than aspirational.
   *
   * There is no `signature` field any more. It used to carry the literal
   * `'accepted-in-app'`, chosen by this client and stored verbatim in a column
   * no read could return — a string that proved nothing about anything. What
   * happened is recorded by the server as the signature's `method`.
   */
  async signLease(
    leaseId: string,
    acceptTerms: boolean,
    termsSha256?: string,
  ): Promise<Lease> {
    const response = await api.post<ApiResponse<Lease>>(`${LEASE_BASE}/${leaseId}/sign`, {
      acceptTerms,
      ...(termsSha256 ? { termsSha256 } : {}),
    });
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Lease signing failed');
    }
    return response.data.data;
  }

  async terminateLease(leaseId: string, data: TerminateLeaseData): Promise<Lease> {
    const response = await api.post<ApiResponse<Lease>>(
      `${LEASE_BASE}/${leaseId}/terminate`,
      data,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Lease termination failed');
    }
    return response.data.data;
  }

  /**
   * Attach a document to a lease.
   *
   * ## The file goes to the LEASE endpoint now
   *
   * It used to go to the images API first, and only the resulting
   * `/api/images/file/<key>` URL was posted here. That route is
   * unauthenticated — it is the one that serves listing photos — so a tenancy
   * agreement, an inspection report and an insurance certificate each became a
   * permanent, shareable link. The bytes travel to `POST /api/leases/:id/
   * documents` instead, which stores them under a private key and hands back a
   * `downloadPath` that needs the session.
   *
   * ## Which also means a PDF works
   *
   * The old path ran every upload through the image pipeline, so a contract had
   * to be a photograph of one. The lease endpoint accepts `application/pdf` and
   * stores it byte for byte.
   *
   * Multipart in the two shapes `applicationService` handles, because React
   * Native has no `File` and web has no `{uri, name, type}`.
   */
  async uploadLeaseDocument(
    leaseId: string,
    input: UploadLeaseDocumentInput,
  ): Promise<LeaseDocument> {
    const filename = input.filename ?? input.name;
    const formData = new FormData();
    formData.append('name', input.name);
    formData.append('type', input.type ?? 'other');

    if (Platform.OS === 'web') {
      if (input.file) {
        formData.append('document', input.file, filename);
      } else {
        const read = await fetch(input.uri);
        if (!read.ok) {
          throw new ApiError(`Failed to read file: ${filename}`, read.status);
        }
        const blob = await read.blob();
        formData.append('document', blob, filename);
      }
    } else {
      formData.append('document', {
        uri: input.uri,
        name: filename,
        type: input.mimeType || 'application/octet-stream',
      } as unknown as Blob);
    }

    const response = await api.post<ApiResponse<LeaseDocument>>(
      `${LEASE_BASE}/${leaseId}/documents`,
      formData,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Document upload failed');
    }
    return response.data.data;
  }
}

export const leaseService = new LeaseService();
export default leaseService;
