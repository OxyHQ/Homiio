/**
 * Admin moderation service — transport for the platform trust & safety queue.
 *
 * Thin class over the Oxy-linked `api` client (`@/utils/api` + `normalizeEnvelope`).
 * Every route is admin-gated server-side (`requireAdmin`); a caller who is not on
 * the admin allowlist gets a 403, which the client surfaces as an `ApiError` with
 * `status: 403` — the screen uses that to render its "not authorised" state
 * (there is NO client-side role logic). The backend wraps its responses in
 * `{ success, <key>, pagination, ... }`; `normalizeEnvelope` keeps that object on
 * `response.data`, so each method reads the named key it needs.
 */

import { api } from '@/utils/api';
import type {
  AdminReviewDTO,
  AdminReviewModerationAction,
  AdminEvictionModerationAction,
  EvictionModerationItem,
} from '@homiio/shared-types';

/** Review queue filter — one paginated server set per tab of the queue. */
export type ReviewModerationFilter = 'under_review' | 'reported' | 'removed';

interface Pagination {
  currentPage: number;
  totalPages: number;
  total?: number;
  limit: number;
}

/** One page of the review moderation queue. */
export interface AdminReviewsPage {
  reviews: AdminReviewDTO[];
  hasMore: boolean;
  totalPages: number;
  page: number;
}

/** One page of the eviction moderation queue (grouped per reported case). */
export interface AdminEvictionsPage {
  items: EvictionModerationItem[];
  hasMore: boolean;
  totalPages: number;
  page: number;
}

const toArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

class AdminModerationService {
  async getReviews(
    filter: ReviewModerationFilter,
    page = 1,
    limit = 20,
  ): Promise<AdminReviewsPage> {
    const { data } = await api.get<{
      reviews?: AdminReviewDTO[];
      hasMore?: boolean;
      totalPages?: number;
      pagination?: Pagination;
    }>('/api/admin/moderation/reviews', { params: { filter, page, limit } });
    return {
      reviews: toArray<AdminReviewDTO>(data.reviews),
      hasMore: data.hasMore ?? false,
      totalPages: data.totalPages ?? data.pagination?.totalPages ?? 1,
      page: data.pagination?.currentPage ?? page,
    };
  }

  async moderateReview(
    reviewId: string,
    action: AdminReviewModerationAction,
  ): Promise<AdminReviewDTO> {
    const { data } = await api.post<{ review: AdminReviewDTO }>(
      `/api/admin/moderation/reviews/${reviewId}`,
      { action },
    );
    return data.review;
  }

  async getEvictions(page = 1, limit = 20): Promise<AdminEvictionsPage> {
    const { data } = await api.get<{
      cases?: EvictionModerationItem[];
      hasMore?: boolean;
      totalPages?: number;
      pagination?: Pagination;
    }>('/api/admin/moderation/evictions', { params: { page, limit } });
    return {
      items: toArray<EvictionModerationItem>(data.cases),
      hasMore: data.hasMore ?? false,
      totalPages: data.totalPages ?? data.pagination?.totalPages ?? 1,
      page: data.pagination?.currentPage ?? page,
    };
  }

  async moderateEviction(
    caseId: string,
    action: AdminEvictionModerationAction,
  ): Promise<void> {
    await api.post(`/api/admin/moderation/evictions/${caseId}`, { action });
  }
}

export const adminModerationService = new AdminModerationService();
export default adminModerationService;
