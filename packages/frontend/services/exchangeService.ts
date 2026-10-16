import { api, type ApiResponse } from '@/utils/api';
import type {
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
 * backend's `{ data, pagination, meta }` envelope. Distinct from reservations
 * (paid vacation bookings) and viewing requests (long-term-rent tours). Every
 * endpoint is auth-gated server-side.
 */

export interface ListExchangeRequestsParams {
  asHost?: boolean;
  status?: ExchangeRequestStatus;
  page?: number;
  limit?: number;
}

interface ExchangePagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ExchangeRequestListResponse {
  items: ExchangeRequest[];
  pagination: ExchangePagination;
}

export interface CreateExchangeReviewBody {
  rating: number;
  comment?: string;
  categories?: ExchangeReviewCategories;
}

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
    const response = await api.post<ApiResponse<ExchangeRequest>>(this.baseUrl, payload);
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Exchange request failed');
    }
    return response.data.data;
  }

  /**
   * List my exchange requests. `asHost: true` returns the host inbox (requests
   * against my listings); otherwise the guest view (requests I made).
   */
  async listMyRequests(
    params: ListExchangeRequestsParams = {},
  ): Promise<ExchangeRequestListResponse> {
    const response = await api.get<{
      data?: ExchangeRequest[];
      pagination?: ExchangePagination;
    }>(this.baseUrl, {
      params: {
        asHost: params.asHost ? 'true' : undefined,
        status: params.status,
        page: params.page,
        limit: params.limit,
      },
    });
    const items = response.data.data ?? [];
    const pagination = response.data.pagination ?? emptyPagination(items.length);
    return { items, pagination };
  }

  async getRequest(id: string): Promise<ExchangeRequest> {
    const response = await api.get<ApiResponse<ExchangeRequest>>(`${this.baseUrl}/${id}`);
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Exchange request not found');
    }
    return response.data.data;
  }

  /**
   * Advance the request status. Host: pending → confirmed/declined. Requester:
   * pending|confirmed → cancelled. Either: confirmed → completed (after the
   * stay window ended). The backend owns the authorization + transition rules.
   */
  async updateStatus(id: string, payload: UpdateExchangeRequestData): Promise<ExchangeRequest> {
    const response = await api.patch<ApiResponse<ExchangeRequest>>(
      `${this.baseUrl}/${id}`,
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Exchange request update failed');
    }
    return response.data.data;
  }

  /** Review the other party of a COMPLETED exchange (one review per reviewer). */
  async createReview(id: string, body: CreateExchangeReviewBody): Promise<ExchangeReview> {
    const response = await api.post<ApiResponse<ExchangeReview>>(
      `${this.baseUrl}/${id}/reviews`,
      body,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Exchange review failed');
    }
    return response.data.data;
  }

  /** Both reviews tied to a single exchange (requester + host). */
  async getRequestReviews(id: string): Promise<ExchangeReview[]> {
    const response = await api.get<ApiResponse<ExchangeReview[]>>(`${this.baseUrl}/${id}/reviews`);
    return response.data.data ?? [];
  }
}

export const exchangeService = new ExchangeService();
