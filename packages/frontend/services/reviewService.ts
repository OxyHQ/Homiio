/**
 * Review Service — the single transport for every review/agency/explore read
 * and write.
 *
 * EVERY method goes through the authed `api` client (`@/utils/api`), which is
 * the Oxy linked client: it mirrors the session token, so the public reads
 * degrade to unauthenticated requests automatically and the authed writes carry
 * the bearer token without any per-call plumbing. The backend wraps its
 * responses in `{ success, <key>, ... }`; `normalizeEnvelope` keeps that whole
 * object on `response.data`, so each method reads the named key it needs
 * (`review`, `reviews`, `cities`, `agency`, …). There is NO raw `fetch` /
 * `API_URL` here — that was the bug this rewrite removes.
 */

import { api } from '@/utils/api';
import type { Property } from '@homiio/shared-types';
import {
  ReviewDTO,
  CreateReviewPayload,
  UpdateReviewPayload,
  ReviewReportReason,
  ReviewModerationStatus,
  AgencySummary,
  AgencyStats,
  ExploreCitySummary,
  ExploreNeighborhoodSummary,
  ExploreBuildingSummary,
} from '@homiio/shared-types';

// Re-export shared types under the legacy consumer aliases.
export type ReviewData = ReviewDTO;
export type CreateReview = CreateReviewPayload;
export type UpdateReview = UpdateReviewPayload;

/** Paging metadata the list endpoints attach. */
export interface ReviewPagination {
  currentPage: number;
  totalPages: number;
  limit: number;
  total?: number;
  totalReviews?: number;
}

/** Flattened address-review payload consumed by the review sections + hooks. */
export interface AddressReviewsResult {
  level?: 'UNIT' | 'BUILDING' | 'STREET';
  /** Building-level reviews (attached directly to the building address). */
  buildingReviews: ReviewDTO[];
  /** Unit-level reviews (attached to a unit under the building). */
  unitReviews: ReviewDTO[];
  /** Building + unit reviews flattened — the list every card row renders. */
  reviews: ReviewDTO[];
  totalReviews: number;
  pagination?: ReviewPagination;
}

/** Result of the helpful-vote toggle. */
export interface HelpfulResult {
  helpfulCount: number;
  viewerHasVotedHelpful: boolean;
}

/** Agency profile header payload. */
export interface AgencyProfile {
  agency: AgencySummary;
  stats: AgencyStats;
}

/** One page of an agency's reviews. */
export interface AgencyReviewsPage {
  agency: AgencySummary;
  reviews: ReviewDTO[];
  hasMore: boolean;
  totalPages: number;
  page: number;
}

/** One page of an agency's active listings. */
export interface AgencyPropertiesPage {
  properties: Property[];
  hasMore: boolean;
  totalPages: number;
  total: number;
  page: number;
}

/** One page of buildings for a neighborhood explore list. */
export interface ExploreBuildingsPage {
  buildings: ExploreBuildingSummary[];
  hasMore: boolean;
  totalPages: number;
  page: number;
}

interface AddressReviewsBody {
  level?: 'UNIT' | 'BUILDING' | 'STREET';
  buildingReviews?: ReviewDTO[];
  unitReviews?: ReviewDTO[];
  totalReviews?: number;
  pagination?: ReviewPagination;
}

const toReviewList = (value: unknown): ReviewDTO[] =>
  Array.isArray(value) ? (value as ReviewDTO[]) : [];

class ReviewService {
  // -----------------------------------------------------------------------
  // Hierarchical address reads (public).
  // -----------------------------------------------------------------------

  async getReviewsByAddress(
    addressId: string,
    page = 1,
    limit = 10,
  ): Promise<AddressReviewsResult> {
    const { data } = await api.get<AddressReviewsBody>(
      `/api/reviews/address/${addressId}`,
      { params: { page, limit }, requireAuth: false },
    );
    const buildingReviews = toReviewList(data.buildingReviews);
    const unitReviews = toReviewList(data.unitReviews);
    return {
      level: data.level,
      buildingReviews,
      unitReviews,
      reviews: [...buildingReviews, ...unitReviews],
      totalReviews: data.totalReviews ?? buildingReviews.length + unitReviews.length,
      pagination: data.pagination,
    };
  }

  async getAddressReviewStats(addressId: string): Promise<Record<string, unknown>> {
    const { data } = await api.get<{ stats?: Record<string, unknown> }>(
      `/api/reviews/address/${addressId}/stats`,
      { requireAuth: false },
    );
    return data.stats ?? {};
  }

  // -----------------------------------------------------------------------
  // Single review CRUD.
  // -----------------------------------------------------------------------

  async createReview(payload: CreateReviewPayload): Promise<ReviewDTO> {
    const { data } = await api.post<{ review: ReviewDTO }>('/api/reviews', payload);
    return data.review;
  }

  async getReviewById(reviewId: string): Promise<ReviewDTO> {
    const { data } = await api.get<{ review: ReviewDTO }>(
      `/api/reviews/${reviewId}`,
      { requireAuth: false },
    );
    return data.review;
  }

  async updateReview(reviewId: string, payload: UpdateReviewPayload): Promise<ReviewDTO> {
    const { data } = await api.put<{ review: ReviewDTO }>(
      `/api/reviews/${reviewId}`,
      payload,
    );
    return data.review;
  }

  async deleteReview(reviewId: string): Promise<void> {
    await api.delete(`/api/reviews/${reviewId}`);
  }

  async getUserReviews(
    oxyUserId: string,
    page = 1,
    limit = 10,
  ): Promise<{ reviews: ReviewDTO[]; hasMore: boolean; totalPages: number; page: number }> {
    const { data } = await api.get<{
      reviews?: ReviewDTO[];
      hasMore?: boolean;
      totalPages?: number;
      pagination?: ReviewPagination;
    }>(`/api/reviews/user/${oxyUserId}`, { params: { page, limit }, requireAuth: false });
    return {
      reviews: toReviewList(data.reviews),
      hasMore: data.hasMore ?? false,
      totalPages: data.totalPages ?? data.pagination?.totalPages ?? 1,
      page: data.pagination?.currentPage ?? page,
    };
  }

  // -----------------------------------------------------------------------
  // Helpful votes + reports (authed).
  // -----------------------------------------------------------------------

  async toggleHelpful(reviewId: string): Promise<HelpfulResult> {
    const { data } = await api.post<HelpfulResult>(`/api/reviews/${reviewId}/helpful`);
    return {
      helpfulCount: data.helpfulCount ?? 0,
      viewerHasVotedHelpful: Boolean(data.viewerHasVotedHelpful),
    };
  }

  async reportReview(
    reviewId: string,
    reason: ReviewReportReason,
    details?: string,
  ): Promise<{ moderationStatus: ReviewModerationStatus }> {
    const { data } = await api.post<{ moderationStatus: ReviewModerationStatus }>(
      `/api/reviews/${reviewId}/report`,
      { reason, details },
    );
    return { moderationStatus: data.moderationStatus };
  }

  // -----------------------------------------------------------------------
  // Agencies (public reads).
  // -----------------------------------------------------------------------

  async searchAgencies(q: string): Promise<AgencySummary[]> {
    const { data } = await api.get<{ agencies?: AgencySummary[] }>(
      '/api/agencies/search',
      { params: { q }, requireAuth: false },
    );
    return Array.isArray(data.agencies) ? data.agencies : [];
  }

  async getAgency(slug: string): Promise<AgencyProfile> {
    const { data } = await api.get<AgencyProfile>(`/api/agencies/${slug}`, {
      requireAuth: false,
    });
    return { agency: data.agency, stats: data.stats };
  }

  async getAgencyReviews(slug: string, page = 1, limit = 10): Promise<AgencyReviewsPage> {
    const { data } = await api.get<{
      agency: AgencySummary;
      reviews?: ReviewDTO[];
      hasMore?: boolean;
      totalPages?: number;
      pagination?: ReviewPagination;
    }>(`/api/agencies/${slug}/reviews`, { params: { page, limit }, requireAuth: false });
    return {
      agency: data.agency,
      reviews: toReviewList(data.reviews),
      hasMore: data.hasMore ?? false,
      totalPages: data.totalPages ?? data.pagination?.totalPages ?? 1,
      page: data.pagination?.currentPage ?? page,
    };
  }

  async getAgencyProperties(slug: string, page = 1, limit = 10): Promise<AgencyPropertiesPage> {
    const { data } = await api.get<{
      data?: Property[];
      hasMore?: boolean;
      totalPages?: number;
      total?: number;
      page?: number;
    }>(`/api/agencies/${slug}/properties`, { params: { page, limit }, requireAuth: false });
    return {
      properties: Array.isArray(data.data) ? data.data : [],
      hasMore: data.hasMore ?? false,
      totalPages: data.totalPages ?? 1,
      total: data.total ?? 0,
      page: data.page ?? page,
    };
  }

  // -----------------------------------------------------------------------
  // Review-explore aggregations (public reads).
  // -----------------------------------------------------------------------

  async getExploreCities(): Promise<ExploreCitySummary[]> {
    const { data } = await api.get<{ cities?: ExploreCitySummary[] }>(
      '/api/reviews/explore',
      { requireAuth: false },
    );
    return Array.isArray(data.cities) ? data.cities : [];
  }

  async getExploreCity(cityId: string): Promise<ExploreNeighborhoodSummary[]> {
    const { data } = await api.get<{ neighborhoods?: ExploreNeighborhoodSummary[] }>(
      `/api/reviews/explore/city/${cityId}`,
      { requireAuth: false },
    );
    return Array.isArray(data.neighborhoods) ? data.neighborhoods : [];
  }

  async getExploreNeighborhood(
    neighborhoodId: string,
    page = 1,
    limit = 10,
  ): Promise<ExploreBuildingsPage> {
    const { data } = await api.get<{
      buildings?: ExploreBuildingSummary[];
      hasMore?: boolean;
      totalPages?: number;
      pagination?: ReviewPagination;
    }>(`/api/reviews/explore/neighborhood/${neighborhoodId}`, {
      params: { page, limit },
      requireAuth: false,
    });
    return {
      buildings: Array.isArray(data.buildings) ? data.buildings : [],
      hasMore: data.hasMore ?? false,
      totalPages: data.totalPages ?? data.pagination?.totalPages ?? 1,
      page: data.pagination?.currentPage ?? page,
    };
  }
}

export const reviewService = new ReviewService();
export default reviewService;
