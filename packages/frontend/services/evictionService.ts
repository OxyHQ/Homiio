import { api, ApiResponse } from '@/utils/api';
import {
  CreateEvictionCaseData,
  CreateEvictionReportInput,
  CreateEvictionTimelineEventData,
  EvictionBoardScope,
  EvictionBoardSort,
  EvictionCase,
  EvictionCaseStatus,
  EvictionComment,
  EvictionHelpNeedType,
  JurisdictionResourceWithId,
  UpdateEvictionCaseData,
} from '@homiio/shared-types';

/**
 * Eviction solidarity board API client.
 *
 * A thin class over `@/utils/api` (the Oxy-linked client + `normalizeEnvelope`
 * bridge) that reads the `{ success, data, … }` envelope. Public reads degrade
 * to unauthenticated requests; every write is auth-gated server-side.
 *
 * ## The board REQUIRES a scope, and this client cannot forget one
 *
 * {@link ListEvictionsParams.scope} is not optional. The server answers a
 * scope-less request with `LOCATION_SCOPE_REQUIRED` rather than the world (ADR
 * 0002's second invariant, #358's "un fallo geográfico no debe mostrar todos los
 * casos"), so a caller that has not resolved a location yet must not call this
 * at all — which is what a required field makes visible at the call site instead
 * of at runtime.
 */

/** How the caller says WHERE it is asking about. There is no implicit answer. */
export interface ListEvictionsParams {
  scope: EvictionBoardScope;
  status?: EvictionCaseStatus;
  sort?: EvictionBoardSort;
  helpNeed?: EvictionHelpNeedType;
  organizationId?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  updatedWithinDays?: number;
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
  /** What the server actually scoped by — not what the caller believes it sent. */
  scope: EvictionBoardScope;
}

export interface EvictionCommentListResponse {
  items: EvictionComment[];
  pagination: EvictionPagination;
  hasMore: boolean;
}

/** Result of an RSVP toggle, including whether the second factor was satisfied. */
export interface EvictionAttendResult {
  attending: boolean;
  attendeeCount: number;
  confirmed: boolean;
  confirmationBasis?: string;
}

/**
 * A write's result: the case, plus what the server removed for privacy.
 *
 * `removedForPrivacy` names CATEGORIES (`building_number`, `phone`), never the
 * removed value. The UI turns each into a sentence explaining which rule fired,
 * which is ADR 0003 §5.8's "what the author is always told".
 */
export interface EvictionWriteResult {
  eviction: EvictionCase;
  removedForPrivacy: string[];
}

export interface JurisdictionResourcesResponse {
  countryCode: string;
  regionId?: string;
  /** Server-supplied, so a new consumer cannot forget to render it. */
  disclaimer: string;
  resources: JurisdictionResourceWithId[];
}

interface BackendEvictionListEnvelope {
  evictions?: EvictionCase[];
  pagination?: EvictionPagination;
  hasMore?: boolean;
  scope?: EvictionBoardScope;
}

interface BackendCommentListEnvelope {
  comments?: EvictionComment[];
  pagination?: EvictionPagination;
  hasMore?: boolean;
}

const emptyPagination = (page: number, count: number): EvictionPagination => ({
  page,
  limit: count,
  total: count,
  totalPages: 1,
});

/** A scope as the query string the backend parses. */
function scopeParams(scope: EvictionBoardScope): Record<string, string | number> {
  switch (scope.kind) {
    case 'global':
      return { global: 'true' };
    case 'city':
      return { city: scope.city };
    case 'bbox':
      return {
        swLat: scope.swLat,
        swLng: scope.swLng,
        neLat: scope.neLat,
        neLng: scope.neLng,
      };
    case 'radius':
      return { lat: scope.lat, lng: scope.lng, radius: scope.radiusMeters };
    case 'following':
      return { following: 'true' };
    case 'attending':
      return { attending: 'true' };
  }
}

class EvictionService {
  private baseUrl = '/api/evictions';

  /** Public board list. The scope is mandatory — see the module header. */
  async list(params: ListEvictionsParams): Promise<EvictionListResponse> {
    const response = await api.get<BackendEvictionListEnvelope>(this.baseUrl, {
      params: {
        ...scopeParams(params.scope),
        status: params.status,
        sort: params.sort,
        helpNeed: params.helpNeed,
        organizationId: params.organizationId,
        scheduledFrom: params.scheduledFrom,
        scheduledTo: params.scheduledTo,
        updatedWithinDays: params.updatedWithinDays,
        page: params.page,
        limit: params.limit,
      },
      requireAuth: false,
    });
    const items = response.data.evictions ?? [];
    const pagination = response.data.pagination ?? emptyPagination(params.page ?? 1, items.length);
    return {
      items,
      pagination,
      hasMore: response.data.hasMore ?? false,
      scope: response.data.scope ?? params.scope,
    };
  }

  /** Public case detail. Viewer flags are populated for a signed-in viewer. */
  async getById(id: string): Promise<EvictionCase> {
    const response = await api.get<ApiResponse<EvictionCase>>(`${this.baseUrl}/${id}`, {
      requireAuth: false,
    });
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Eviction case not found');
    }
    return response.data.data;
  }

  /** Open a new case (authed). */
  async create(payload: CreateEvictionCaseData): Promise<EvictionWriteResult> {
    const response = await api.post<ApiResponse<EvictionWriteResult>>(this.baseUrl, payload);
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not create the eviction case');
    }
    return response.data.data;
  }

  /** Edit an owned case (authed, owner-only server-side). */
  async update(id: string, payload: UpdateEvictionCaseData): Promise<EvictionWriteResult> {
    const response = await api.put<ApiResponse<EvictionWriteResult>>(
      `${this.baseUrl}/${id}`,
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not update the eviction case');
    }
    return response.data.data;
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

  /** Follow toggle ("tell me if this changes"). Separate from attending. */
  async toggleFollow(id: string): Promise<{ following: boolean }> {
    const response = await api.post<ApiResponse<{ following: boolean }>>(
      `${this.baseUrl}/${id}/follow`,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not update your follow');
    }
    return response.data.data;
  }

  /** Owner-only: append a timeline entry (reschedule / status change / note). */
  async createUpdate(
    id: string,
    payload: CreateEvictionTimelineEventData,
  ): Promise<EvictionWriteResult> {
    const response = await api.post<ApiResponse<EvictionWriteResult>>(
      `${this.baseUrl}/${id}/updates`,
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not post the update');
    }
    return response.data.data;
  }

  /** Public coordination thread, newest-first, paginated. */
  async listComments(id: string, page = 1, limit = 20): Promise<EvictionCommentListResponse> {
    const response = await api.get<BackendCommentListEnvelope>(`${this.baseUrl}/${id}/comments`, {
      params: { page, limit },
      requireAuth: false,
    });
    const items = response.data.comments ?? [];
    const pagination = response.data.pagination ?? emptyPagination(page, items.length);
    return { items, pagination, hasMore: response.data.hasMore ?? false };
  }

  /** Post a comment on a case (authed). */
  async createComment(id: string, body: string): Promise<EvictionComment> {
    const response = await api.post<ApiResponse<EvictionComment>>(
      `${this.baseUrl}/${id}/comments`,
      { body },
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not post your comment');
    }
    return response.data.data;
  }

  /** Delete a comment (author or case owner, authed). */
  async deleteComment(id: string, commentId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${id}/comments/${commentId}`);
  }

  /** File a community report against a case (authed). */
  async report(id: string, input: CreateEvictionReportInput): Promise<void> {
    await api.post(`${this.baseUrl}/${id}/report`, input);
  }

  /**
   * Legal and housing resources for a jurisdiction. PUBLIC and read-only.
   *
   * An EMPTY list is a legitimate answer — nobody has verified anything for that
   * jurisdiction yet — and the UI says so rather than showing a neighbouring
   * country's.
   */
  async resources(
    countryCode: string,
    regionId?: string,
  ): Promise<JurisdictionResourcesResponse> {
    const response = await api.get<ApiResponse<JurisdictionResourcesResponse>>(
      `${this.baseUrl}/resources`,
      { params: { countryCode, regionId }, requireAuth: false },
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Could not load local resources');
    }
    return response.data.data;
  }

  /** The caller's own cases (authed). */
  async myCases(page = 1, limit = 20): Promise<EvictionListResponse> {
    const response = await api.get<BackendEvictionListEnvelope>(`${this.baseUrl}/me/list`, {
      params: { page, limit },
    });
    const items = response.data.evictions ?? [];
    const pagination = response.data.pagination ?? emptyPagination(page, items.length);
    return {
      items,
      pagination,
      hasMore: response.data.hasMore ?? false,
      scope: response.data.scope ?? { kind: 'global' },
    };
  }

  /** Cases the caller RSVP'd to (authed). */
  async myAttending(page = 1, limit = 20): Promise<EvictionListResponse> {
    const response = await api.get<BackendEvictionListEnvelope>(`${this.baseUrl}/me/attending`, {
      params: { page, limit },
    });
    const items = response.data.evictions ?? [];
    const pagination = response.data.pagination ?? emptyPagination(page, items.length);
    return {
      items,
      pagination,
      hasMore: response.data.hasMore ?? false,
      scope: response.data.scope ?? { kind: 'attending' },
    };
  }

  /** Cases the caller FOLLOWS (authed). */
  async myFollowing(page = 1, limit = 20): Promise<EvictionListResponse> {
    const response = await api.get<BackendEvictionListEnvelope>(`${this.baseUrl}/me/following`, {
      params: { page, limit },
    });
    const items = response.data.evictions ?? [];
    const pagination = response.data.pagination ?? emptyPagination(page, items.length);
    return {
      items,
      pagination,
      hasMore: response.data.hasMore ?? false,
      scope: response.data.scope ?? { kind: 'following' },
    };
  }
}

export const evictionService = new EvictionService();

export default evictionService;
