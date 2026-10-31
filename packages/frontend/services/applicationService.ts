/**
 * Tenant Application Service
 *
 * Wraps the long-term rent `/api/applications` endpoints. Used by both the
 * applicant flow (apply, view my applications, withdraw) and the landlord
 * inbox (review submissions, approve / reject).
 *
 * Every request — including the multipart document uploads — goes through the
 * shared `api` helper, which is backed by the Oxy-linked backend client. The
 * linked client keeps the bearer token in lockstep with the session, delegates
 * preflight/401 refresh to the session owner, and detects `FormData` bodies to
 * let the browser/native runtime set the multipart boundary header itself.
 */
import { Platform } from 'react-native';
import {
  APPLICATION_DOCUMENT_MAX_BYTES,
  APPLICATION_DOCUMENT_MAX_COUNT,
  planUploadBatches,
} from '@homiio/shared-types/upload';
import { TenantApplicationStatus } from '@homiio/shared-types/application';
import type {
  DocumentVerificationStatus,
  EmploymentStatus,
  ReferenceRelationship,
  TenantApplication,
  TenantApplicationDocumentType,
} from '@homiio/shared-types';

import { api, ApiError, type ApiResponse } from '@/utils/api';

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
  /** The file's size, when the picker reports one; plans the requests. */
  sizeBytes?: number;
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

const DOCUMENT_BATCH_LIMITS = {
  maxFileBytes: APPLICATION_DOCUMENT_MAX_BYTES,
  maxFilesPerRequest: APPLICATION_DOCUMENT_MAX_COUNT,
};

/** The size a document is planned at: the picker's, or the File's on web. */
function documentSize(doc: ApplicationDocumentUpload): number | undefined {
  return doc.sizeBytes ?? doc.file?.size;
}

async function appendDocuments(
  formData: FormData,
  documents: readonly ApplicationDocumentUpload[],
): Promise<void> {
  formData.append('documentTypes', JSON.stringify(documents.map((d) => d.type)));
  for (const doc of documents) {
    await appendFileToFormData(formData, 'documents', doc);
  }
}

export const applicationService = {
  /**
   * The landlord's judgement of one attached document (#518 §7.4).
   *
   * The only route that can move a document to `verified`. The server refuses
   * anybody but the application's landlord, and refuses a rejection with no
   * reason — both are checked there rather than trusted from here.
   */
  async verifyDocument(
    applicationId: string,
    input: { documentId: string; status: DocumentVerificationStatus; reason?: string },
  ): Promise<TenantApplication> {
    const response = await api.post<ApiResponse<TenantApplication>>(
      `${API_BASE_PATH}/${applicationId}/documents/${input.documentId}/verification`,
      { status: input.status, ...(input.reason ? { reason: input.reason } : {}) },
    );
    if (!response.data.data) throw new ApiError('The verification response carried no application');
    return response.data.data;
  },

  /**
   * Submit a long-term tenant application with its documents, stored by the
   * backend as private files in the applicant's own Oxy account.
   *
   * One request may carry at most `UPLOAD_REQUEST_MAX_BYTES`
   * (`shared-types`), so the documents are planned into batches: the first
   * travels with the submission and each further one is attached to the new
   * application (`POST /:id/documents`). Nearly every submission is a single
   * request. If a further batch fails, the application is withdrawn before the
   * error is rethrown, so the person sees what they always saw — a failed
   * submission they can send again — rather than an application missing
   * documents they picked.
   */
  async create(input: CreateApplicationInput): Promise<TenantApplication> {
    const [first = [], ...rest] = planUploadBatches(
      input.documents ?? [],
      documentSize,
      DOCUMENT_BATCH_LIMITS,
    );
    let application = await applicationService.submit(input, first);
    for (const batch of rest) {
      try {
        application = await applicationService.addDocuments(String(application.id), batch);
      } catch (error) {
        await applicationService
          .update(String(application.id), {
            status: TenantApplicationStatus.WITHDRAWN,
          })
          .catch(() => undefined);
        throw error;
      }
    }
    return application;
  },

  /** The submission request itself, with the documents that fit it. */
  async submit(
    input: CreateApplicationInput,
    documents: readonly ApplicationDocumentUpload[],
  ): Promise<TenantApplication> {
    const formData = new FormData();
    formData.append('propertyId', input.propertyId);
    formData.append('moveInDate', input.moveInDate);
    formData.append('leaseTermMonths', String(input.leaseTermMonths));
    formData.append('monthlyIncome', String(input.monthlyIncome));
    formData.append('employmentStatus', input.employmentStatus);
    formData.append('referenceContacts', JSON.stringify(input.referenceContacts));
    if (input.notes) formData.append('notes', input.notes);

    if (documents.length > 0) await appendDocuments(formData, documents);

    const response = await api.post<ApiResponse<TenantApplication>>(API_BASE_PATH, formData);
    const created = response.data?.data;
    if (!created) {
      throw new ApiError('Empty application response', 500, response.data);
    }
    return created;
  },

  /** Attach more documents to the person's own pending application. */
  async addDocuments(
    applicationId: string,
    documents: readonly ApplicationDocumentUpload[],
  ): Promise<TenantApplication> {
    const formData = new FormData();
    await appendDocuments(formData, documents);
    const response = await api.post<ApiResponse<TenantApplication>>(
      `${API_BASE_PATH}/${applicationId}/documents`,
      formData,
    );
    const updated = response.data?.data;
    if (!updated) {
      throw new ApiError('Empty application response', 500, response.data);
    }
    return updated;
  },

  async list(
    params: {
      asLandlord?: boolean;
      status?: TenantApplicationStatus;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<ApplicationListResponse> {
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
