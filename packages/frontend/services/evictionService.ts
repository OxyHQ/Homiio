import { api, ApiResponse } from '@/utils/api';
import {
  CreateEvictionCaseData,
  CreateEvictionReportInput,
  CreateEvictionUpdateData,
  EvictionCase,
  EvictionCaseStatus,
  EvictionComment,
  UpdateEvictionCaseData,
} from '@homiio/shared-types';

/**
 * Eviction solidarity board API client.
 *
 * Mirrors `exchangeService`: a thin class over `@/utils/api` (the Oxy-linked
 * client + `normalizeEnvelope` bridge) that reads the `{ success, data, … }`
 * envelope and normalises the persisted `_id` to `id`. Public reads
 * (`list`/`getById`/`listComments`) degrade to unauthenticated requests; every
 * write is auth-gated server-side.
 *
 * The backend already serialises `_id → id` in `toEvictionDTO`, so the local
 * `normalizeCase`/`normalizeComment` steps are defensive (never trust a raw
 * `_id` leak) rather than load-bearing.
 */

/** Public board filters. Omitting `status` lets the backend default to `upcoming`. */
export interface ListEvictionsParams {
  status?: EvictionCaseStatus;
  city?: string;
  page?: number;
  limit?: number;
}

export interface EvictionPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface EvictionListResponse {
  items: EvictionCase[];
  pagination: EvictionPagination;
  hasMore: boolean;
}

export interface EvictionCommentListResponse {
  items: EvictionComment[];
  pagination: EvictionPagination;
  hasMore: boolean;
}

/** Result of an RSVP toggle. */
export interface EvictionAttendResult {
  attending: boolean;
  attendeeCount: number;
}

/** Backend records may carry `_id`; the frontend works with `id`. */
type BackendEvictionCase = Omit<EvictionCase, 'id'> & { _id?: string; id?: string };
type BackendEvictionComment = Omit<EvictionComment, 'id'> & { _id?: string; id?: string };

/** Raw list envelope: the backend nests `pagination` and exposes flat aliases. */
interface BackendEvictionListEnvelope {
  evictions?: BackendEvictionCase[];
  pagination?: EvictionPagination;
  hasMore?: boolean;
}

interface BackendCommentListEnvelope {
  comments?: BackendEvictionComment[];
  pagination?: EvictionPagination;
  hasMore?: boolean;
}

const normalizeCase = (raw: BackendEvictionCase): EvictionCase => {
  const id = raw.id ?? raw._id ?? '';
  return { ...raw, id } as EvictionCase;
};

const normalizeComment = (raw: BackendEvictionComment): EvictionComment => {
  const id = raw.id ?? raw._id ?? '';
  return { ...raw, id } as EvictionComment;
};

const emptyPagination = (page: number, count: number): EvictionPagination => ({
  page,
  limit: count,
  total: count,
  totalPages: 1,
});

class EvictionService {
  private baseUrl = '/api/evictions';

  /** Public board list. Defaults to soonest-first `upcoming` cases. */
  async list(params: ListEvictionsParams = {}): Promise<EvictionListResponse> {
    const response = await api.get<BackendEvictionListEnvelope>(this.baseUrl, {
      params: {
        status: params.status,
        city: params.city,
        page: params.page,
        limit: params.limit,
      },
      requireAuth: false,
    });
    const items = (response.data.evictions ?? []).map(normalizeCase);
    const pagination = response.data.pagination ?? emptyPagination(params.page ?? 1, items.length);
    return { items, pagination, hasMore: response.data.hasMore ?? false };
  }

  /** Public case detail. `isAttending`/`isOwner` are populated for a signed viewer. */
  async getById(id: string): Promise<EvictionCase> {
    const response = await api.get<ApiResponse<BackendEvictionCase>>(
      `${this.baseUrl}/${id}`,
      { requireAuth: false },
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Eviction case not found');
    }
    return normalizeCase(response.data.data);
  }

  /** Open a new case (authed). */
  async create(payload: CreateEvictionCaseData): Promise<EvictionCase> {
    const response = await api.post<ApiResponse<BackendEvictionCase>>(this.baseUrl, payload);
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not create the eviction case');
    }
    return normalizeCase(response.data.data);
  }

  /** Edit an owned case (authed, owner-only server-side). */
  async update(id: string, payload: UpdateEvictionCaseData): Promise<EvictionCase> {
    const response = await api.put<ApiResponse<BackendEvictionCase>>(
      `${this.baseUrl}/${id}`,
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not update the eviction case');
    }
    return normalizeCase(response.data.data);
  }

  /** Delete an owned case (authed, owner-only server-side). */
  async remove(id: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${id}`);
  }

  /** RSVP toggle ("I'll show up"). Returns the new state + aggregate count. */
  async toggleAttend(id: string): Promise<EvictionAttendResult> {
    const response = await api.post<ApiResponse<EvictionAttendResult>>(
      `${this.baseUrl}/${id}/attend`,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not update your RSVP');
    }
    return response.data.data;
  }

  /** Owner-only: append a timeline update (reschedule / status change / note). */
  async createUpdate(id: string, payload: CreateEvictionUpdateData): Promise<EvictionCase> {
    const response = await api.post<ApiResponse<BackendEvictionCase>>(
      `${this.baseUrl}/${id}/updates`,
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not post the update');
    }
    return normalizeCase(response.data.data);
  }

  /** Public coordination thread, newest-first, paginated. */
  async listComments(id: string, page = 1, limit = 20): Promise<EvictionCommentListResponse> {
    const response = await api.get<BackendCommentListEnvelope>(
      `${this.baseUrl}/${id}/comments`,
      { params: { page, limit }, requireAuth: false },
    );
    const items = (response.data.comments ?? []).map(normalizeComment);
    const pagination = response.data.pagination ?? emptyPagination(page, items.length);
    return { items, pagination, hasMore: response.data.hasMore ?? false };
  }

  /** Post a comment on a case (authed). */
  async createComment(id: string, body: string): Promise<EvictionComment> {
    const response = await api.post<ApiResponse<BackendEvictionComment>>(
      `${this.baseUrl}/${id}/comments`,
      { body },
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not post your comment');
    }
    return normalizeComment(response.data.data);
  }

  /** Delete a comment (author or case owner, authed). */
  async deleteComment(id: string, commentId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${id}/comments/${commentId}`);
  }

  /** File a trust & safety report against a case (authed). */
  async report(id: string, input: CreateEvictionReportInput): Promise<void> {
    await api.post(`${this.baseUrl}/${id}/report`, input);
  }

  /** The caller's own cases (authed). */
  async myCases(page = 1, limit = 20): Promise<EvictionListResponse> {
    const response = await api.get<BackendEvictionListEnvelope>(`${this.baseUrl}/me/list`, {
      params: { page, limit },
    });
    const items = (response.data.evictions ?? []).map(normalizeCase);
    const pagination = response.data.pagination ?? emptyPagination(page, items.length);
    return { items, pagination, hasMore: response.data.hasMore ?? false };
  }

  /** Cases the caller RSVP'd to (authed). */
  async myAttending(page = 1, limit = 20): Promise<EvictionListResponse> {
    const response = await api.get<BackendEvictionListEnvelope>(`${this.baseUrl}/me/attending`, {
      params: { page, limit },
    });
    const items = (response.data.evictions ?? []).map(normalizeCase);
    const pagination = response.data.pagination ?? emptyPagination(page, items.length);
    return { items, pagination, hasMore: response.data.hasMore ?? false };
  }
}

export const evictionService = new EvictionService();

export default evictionService;
