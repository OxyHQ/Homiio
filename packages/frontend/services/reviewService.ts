/**
 * Review Service
 * API calls for review-related operations
 */

import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/core';
import { ApiResponse } from '../types/api';
import { 
  ReviewDocument, 
  CreateReviewRequest,
  UpdateReviewRequest
} from '@homiio/shared-types';

// Re-export shared types
export type ReviewData = ReviewDocument;
export type CreateReview = CreateReviewRequest;
export type UpdateReview = UpdateReviewRequest;

export interface ReviewStats {
  averageRating: number;
  totalReviews: number;
  recommendationPercentage: number;
  ratingDistribution: {
    _id: number;
    count: number;
  }[];
  categoryAverages: {
    condition: number;
    landlord: number;
    neighbors: number;
    security: number;
  };
}

export interface ReviewsResponse {
  reviews: ReviewData[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalReviews: number;
    limit: number;
  };
  stats: {
    averageRating: number;
    totalReviews: number;
    recommendationPercentage: number;
  };
}

class ReviewService {
  private baseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

  /**
   * Get reviews for a specific address
   */
  async getReviewsByAddress(
    addressId: string,
    page: number = 1,
    limit: number = 10,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<ApiResponse<ReviewsResponse>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/reviews/address/${addressId}?page=${page}&limit=${limit}&sortBy=${sortBy}&sortOrder=${sortOrder}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data: data,
        message: 'Reviews fetched successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch reviews',
        data: null
      };
    }
  }

  /**
   * Get review statistics for an address
   */
  async getAddressReviewStats(addressId: string): Promise<ApiResponse<ReviewStats>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/reviews/address/${addressId}/stats`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data: data,
        message: 'Review stats fetched successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch review stats',
        data: null
      };
    }
  }

  /**
   * Create a new review
   */
  async createReview(
    reviewData: Partial<ReviewData>,
    oxyServices?: OxyServices,
    activeSessionId?: string
  ): Promise<ApiResponse<{ review: ReviewData }>> {
    try {
      const response = await api.post('/api/reviews', reviewData, {
        oxyServices,
        activeSessionId,
      });

      return {
        success: true,
        data: response.data,
        message: 'Review created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create review',
        data: null
      };
    }
  }

  /**
   * Get a specific review by ID
   */
  async getReviewById(reviewId: string): Promise<ApiResponse<{ review: ReviewData }>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/reviews/${reviewId}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data: data,
        message: 'Review fetched successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch review',
        data: null
      };
    }
  }

  /**
   * Update a review
   */
  async updateReview(
    reviewId: string, 
    updateData: Partial<ReviewData>
  ): Promise<ApiResponse<{ review: ReviewData }>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/reviews/${reviewId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data: data,
        message: 'Review updated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update review',
        data: null
      };
    }
  }

  /**
   * Delete a review
   */
  async deleteReview(reviewId: string): Promise<ApiResponse<{ message: string }>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/reviews/${reviewId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data: data,
        message: 'Review deleted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete review',
        data: null
      };
    }
  }

  /**
   * Get user's reviews
   */
  async getUserReviews(
    userId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<ApiResponse<ReviewsResponse>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/reviews/user/${userId}?page=${page}&limit=${limit}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data: data,
        message: 'User reviews fetched successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch user reviews',
        data: null
      };
    }
  }
}

export const reviewService = new ReviewService();
export default reviewService;
