/**
 * Tenant Application Service
 *
 * Wraps the long-term rent `/api/applications` endpoints. Used by both the
 * applicant flow (apply, view my applications, withdraw) and the landlord
 * inbox (review submissions, approve / reject).
 *
 * Multipart uploads bypass the JSON `api` helper and go through a direct
 * authenticated `fetch` so the browser/native runtime can set the multipart
 * boundary header automatically.
 */
import { Platform } from 'react-native';
import { oxyClient } from '@oxyhq/core';
import {
  EmploymentStatus,
  ReferenceRelationship,
  TenantApplication,
  TenantApplicationDocumentType,
  TenantApplicationStatus,
} from '@homiio/shared-types';

import { api, ApiError, ApiResponse } from '@/utils/api';
import { API_URL } from '@/config';

export type ApplicationReferenceInput = {
  name: string;
  relationship: ReferenceRelationship;
  phone: string;
  email: string;
};

export type ApplicationDocumentUpload = {
  type: TenantApplicationDocumentType;
  filename: string;
  /** Source URI (web `blob:` or native file path). */
  uri: string;
  /** MIME type. Falls back to `application/octet-stream` when unknown. */
  mimeType?: string;
  /** Optional File handle (web only). Preferred over fetching the URI. */
  file?: File;
};

export type CreateApplicationInput = {
  propertyId: string;
  moveInDate: string;
  leaseTermMonths: number;
  monthlyIncome: number;
  employmentStatus: EmploymentStatus;
  referenceContacts: ApplicationReferenceInput[];
  documents?: ApplicationDocumentUpload[];
  notes?: string;
};

export type UpdateApplicationInput = {
  status?: TenantApplicationStatus;
  notes?: string;
};

export type ApplicationListResponse = {
  data: TenantApplication[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages?: number;
    pages?: number;
  };
};

const API_BASE_PATH = '/api/applications';

async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const token = await oxyClient.getAccessToken();
    if (!token) throw new ApiError('Authentication required', 401);
    return { Authorization: `Bearer ${token}` };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Authentication required', 401);
  }
}

async function appendFileToFormData(
  formData: FormData,
  field: string,
  doc: ApplicationDocumentUpload,
): Promise<void> {
  if (Platform.OS === 'web') {
    if (doc.file) {
      formData.append(field, doc.file, doc.filename);
      return;
    }
    const response = await fetch(doc.uri);
    if (!response.ok) {
      throw new ApiError(`Failed to read file: ${doc.filename}`, response.status);
    }
    const blob = await response.blob();
    const inferredType = doc.mimeType || blob.type || 'application/octet-stream';
    const file = new File([blob], doc.filename, { type: inferredType });
    formData.append(field, file, doc.filename);
    return;
  }
  // React Native uses the `{uri, name, type}` shape (no File polyfill).
  formData.append(field, {
    uri: doc.uri,
    name: doc.filename,
    type: doc.mimeType || 'application/octet-stream',
  } as unknown as Blob);
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const data = payload as Record<string, unknown>;
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    if (typeof data.error === 'string' && data.error.trim()) return data.error;
    if (data.error && typeof data.error === 'object') {
      const err = data.error as Record<string, unknown>;
      if (typeof err.message === 'string' && err.message.trim()) return err.message;
    }
  }
  return `HTTP ${status}`;
}

export const applicationService = {
  /**
   * Submit a long-term tenant application. Documents are uploaded inline as
   * a single multipart request — the backend persists each file to S3 and
   * returns the populated application document.
   */
  async create(input: CreateApplicationInput): Promise<TenantApplication> {
    const formData = new FormData();
    formData.append('propertyId', input.propertyId);
    formData.append('moveInDate', input.moveInDate);
    formData.append('leaseTermMonths', String(input.leaseTermMonths));
    formData.append('monthlyIncome', String(input.monthlyIncome));
    formData.append('employmentStatus', input.employmentStatus);
    formData.append('referenceContacts', JSON.stringify(input.referenceContacts));
    if (input.notes) formData.append('notes', input.notes);

    const documents = input.documents ?? [];
    if (documents.length > 0) {
      formData.append(
        'documentTypes',
        JSON.stringify(documents.map((d) => d.type)),
      );
      for (const doc of documents) {
        await appendFileToFormData(formData, 'documents', doc);
      }
    }

    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}${API_BASE_PATH}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        extractErrorMessage(payload, response.status),
        response.status,
        payload,
      );
    }
    const created = (payload as ApiResponse<TenantApplication> | null)?.data;
    if (!created) {
      throw new ApiError('Empty application response', response.status, payload);
    }
    return created;
  },

  async list(params: { asLandlord?: boolean; status?: TenantApplicationStatus; page?: number; limit?: number } = {}): Promise<ApplicationListResponse> {
    const response = await api.get<ApplicationListResponse & ApiResponse<TenantApplication[]>>(
      API_BASE_PATH,
      {
        params: {
          asLandlord: params.asLandlord ? 'true' : undefined,
          status: params.status,
          page: params.page,
          limit: params.limit,
        },
      },
    );
    const body = response.data;
    const items: TenantApplication[] = Array.isArray(body?.data) ? body.data : [];
    return {
      data: items,
      pagination: body?.pagination,
    };
  },

  async getById(id: string): Promise<TenantApplication> {
    const response = await api.get<ApiResponse<TenantApplication>>(`${API_BASE_PATH}/${id}`);
    const application = response.data?.data;
    if (!application) {
      throw new ApiError('Application not found', 404, response.data);
    }
    return application;
  },

  async update(id: string, input: UpdateApplicationInput): Promise<TenantApplication> {
    const response = await api.patch<ApiResponse<TenantApplication>>(
      `${API_BASE_PATH}/${id}`,
      input,
    );
    const updated = response.data?.data;
    if (!updated) {
      throw new ApiError('Empty application response', 500, response.data);
    }
    return updated;
  },
};

export default applicationService;
