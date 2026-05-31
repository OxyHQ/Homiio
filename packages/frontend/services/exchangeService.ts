import { api, ApiResponse } from '@/utils/api';
import {
  CreateExchangeRequestData,
  ExchangeRequest,
  ExchangeReview,
  ExchangeReviewCategories,
  ExchangeRequestStatus,
  UpdateExchangeRequestData,
} from '@homiio/shared-types';

/**
 * Home-exchange API client (swap + free hosting).
 *
 * Mirrors `reservationService`: a thin class over `@/utils/api` that unwraps the
 * backend's `{ data, pagination, meta }` envelope and normalises the persisted
 * `_id` to `id`. Distinct from reservations (paid vacation bookings) and viewing
 * requests (long-term-rent tours). Every endpoint is auth-gated server-side.
 */

export interface ListExchangeRequestsParams {
  asHost?: boolean;
  status?: ExchangeRequestStatus;
  page?: number;
  limit?: number;
}

export interface ExchangePagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ExchangeRequestListResponse {
  items: ExchangeRequest[];
  pagination: ExchangePagination;
}

/** Aggregate trust meta returned alongside a profile's exchange reviews. */
export interface ProfileExchangeReviewsMeta {
  averageRating: number;
  reviewCount: number;
}

export interface ProfileExchangeReviewsResponse {
  items: ExchangeReview[];
  pagination: ExchangePagination;
  meta: ProfileExchangeReviewsMeta;
}

export interface CreateExchangeReviewBody {
  rating: number;
  comment?: string;
  categories?: ExchangeReviewCategories;
}

/** Backend records carry `_id`; the frontend works with `id`. */
type BackendExchangeRequest = Omit<ExchangeRequest, 'id'> & {
  _id?: string;
  id?: string;
};

type BackendExchangeReview = Omit<ExchangeReview, 'id'> & {
  _id?: string;
  id?: string;
};

const normalizeRequest = (raw: BackendExchangeRequest): ExchangeRequest => {
  const id = raw.id ?? raw._id ?? '';
  return { ...raw, id } as ExchangeRequest;
};

const normalizeReview = (raw: BackendExchangeReview): ExchangeReview => {
  const id = raw.id ?? raw._id ?? '';
  return { ...raw, id } as ExchangeReview;
};

const emptyPagination = (count: number): ExchangePagination => ({
  page: 1,
  limit: count,
  total: count,
  totalPages: 1,
});

class ExchangeService {
  private baseUrl = '/api/exchanges';

  /** Propose a swap or hosting stay against an EXCHANGE listing. */
  async createRequest(payload: CreateExchangeRequestData): Promise<ExchangeRequest> {
    const response = await api.post<ApiResponse<BackendExchangeRequest>>(
      this.baseUrl,
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Exchange request failed');
    }
    return normalizeRequest(response.data.data);
  }

  /**
   * List my exchange requests. `asHost: true` returns the host inbox (requests
   * against my listings); otherwise the guest view (requests I made).
   */
  async listMyRequests(
    params: ListExchangeRequestsParams = {},
  ): Promise<ExchangeRequestListResponse> {
    const response = await api.get<{
      data?: BackendExchangeRequest[];
      pagination?: ExchangePagination;
    }>(this.baseUrl, {
      params: {
        asHost: params.asHost ? 'true' : undefined,
        status: params.status,
        page: params.page,
        limit: params.limit,
      },
    });
    const items = (response.data.data ?? []).map(normalizeRequest);
    const pagination = response.data.pagination ?? emptyPagination(items.length);
    return { items, pagination };
  }

  async getRequest(id: string): Promise<ExchangeRequest> {
    const response = await api.get<ApiResponse<BackendExchangeRequest>>(
      `${this.baseUrl}/${id}`,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Exchange request not found');
    }
    return normalizeRequest(response.data.data);
  }

  /**
   * Advance the request status. Host: pending → confirmed/declined. Requester:
   * pending|confirmed → cancelled. Either: confirmed → completed (after the
   * stay window ended). The backend owns the authorization + transition rules.
   */
  async updateStatus(
    id: string,
    payload: UpdateExchangeRequestData,
  ): Promise<ExchangeRequest> {
    const response = await api.patch<ApiResponse<BackendExchangeRequest>>(
      `${this.baseUrl}/${id}`,
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Exchange request update failed');
    }
    return normalizeRequest(response.data.data);
  }

  /** Review the other party of a COMPLETED exchange (one review per reviewer). */
  async createReview(
    id: string,
    body: CreateExchangeReviewBody,
  ): Promise<ExchangeReview> {
    const response = await api.post<ApiResponse<BackendExchangeReview>>(
      `${this.baseUrl}/${id}/reviews`,
      body,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Exchange review failed');
    }
    return normalizeReview(response.data.data);
  }

  /** Both reviews tied to a single exchange (requester + host). */
  async getRequestReviews(id: string): Promise<ExchangeReview[]> {
    const response = await api.get<ApiResponse<BackendExchangeReview[]>>(
      `${this.baseUrl}/${id}/reviews`,
    );
    return (response.data.data ?? []).map(normalizeReview);
  }

  /**
   * Reviews where a profile is the SUBJECT (trust signal), paginated, with an
   * aggregate average rating + count carried in `meta`.
   */
  async getProfileReviews(
    profileId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<ProfileExchangeReviewsResponse> {
    const response = await api.get<{
      data?: BackendExchangeReview[];
      pagination?: ExchangePagination;
      meta?: Partial<ProfileExchangeReviewsMeta>;
    }>(`/api/profiles/${profileId}/exchange-reviews`, {
      params: { page: params.page, limit: params.limit },
    });
    const items = (response.data.data ?? []).map(normalizeReview);
    const pagination = response.data.pagination ?? emptyPagination(items.length);
    const meta: ProfileExchangeReviewsMeta = {
      averageRating: response.data.meta?.averageRating ?? 0,
      reviewCount: response.data.meta?.reviewCount ?? pagination.total,
    };
    return { items, pagination, meta };
  }
}

export const exchangeService = new ExchangeService();

export default exchangeService;
