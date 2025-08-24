/**
 * Review Controller
 * Handles CRUD operations for address reviews
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
const { Review, Address } = require('../models');

/**
 * Response helpers
 */
const ok = (res: Response, data: any) => res.status(200).json({ success: true, ...data });
const created = (res: Response, data: any) => res.status(201).json({ success: true, ...data });
const badRequest = (res: Response, data: any) => res.status(400).json({ success: false, ...data });
const notFound = (res: Response, data: any) => res.status(404).json({ success: false, ...data });
const serverError = (res: Response, data: any) => res.status(500).json({ success: false, ...data });

const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, error?: any) => console.error(`[ERROR] ${message}`, error || '')
};

/**
 * Get all reviews for a specific address
 * GET /api/reviews/address/:addressId
 */
export const getReviewsByAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    if (!Types.ObjectId.isValid(addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    // Check if address exists
    const address = await Address.findById(addressId);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);
    const skip = (pageNumber - 1) * limitNumber;

    const sortDirection = sortOrder === 'desc' ? -1 : 1;
    const sortOptions: any = { [sortBy as string]: sortDirection };

    const reviews = await Review.find({ addressId })
      .populate('profileId', 'profileType personalProfile agencyProfile')
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNumber)
      .lean();

    const totalReviews = await Review.countDocuments({ addressId });
    const stats = await Review.getAverageRating(addressId);

    return ok(res, {
      reviews,
      pagination: {
        currentPage: pageNumber,
        totalPages: Math.ceil(totalReviews / limitNumber),
        totalReviews,
        limit: limitNumber
      },
      stats: {
        averageRating: Number(stats.averageRating.toFixed(1)),
        totalReviews: stats.totalReviews,
        recommendationPercentage: Number(stats.recommendationPercentage.toFixed(1))
      }
    });

  } catch (error) {
    logger.error('Error fetching reviews by address:', error);
    return serverError(res, { message: 'Failed to fetch reviews' });
  }
};

/**
 * Get review statistics for an address
 * GET /api/reviews/address/:addressId/stats
 */
export const getAddressReviewStats = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;

    if (!Types.ObjectId.isValid(addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    const stats = await Review.getAverageRating(addressId);
    
    // Get rating distribution
    const ratingDistribution = await Review.aggregate([
      { $match: { addressId: new Types.ObjectId(addressId) } },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } }
    ]);

    // Get category averages
    const categoryAverages = await Review.aggregate([
      { $match: { addressId: new Types.ObjectId(addressId) } },
      {
        $group: {
          _id: null,
          avgCondition: { $avg: { $switch: {
            branches: [
              { case: { $eq: ['$conditionAndMaintenance', 'poor'] }, then: 1 },
              { case: { $eq: ['$conditionAndMaintenance', 'fair'] }, then: 2 },
              { case: { $eq: ['$conditionAndMaintenance', 'good'] }, then: 3 },
              { case: { $eq: ['$conditionAndMaintenance', 'very_good'] }, then: 4 },
              { case: { $eq: ['$conditionAndMaintenance', 'excellent'] }, then: 5 }
            ],
            default: 3
          }}},
          avgLandlord: { $avg: { $switch: {
            branches: [
              { case: { $eq: ['$landlordTreatment', 'very_poor'] }, then: 1 },
              { case: { $eq: ['$landlordTreatment', 'poor'] }, then: 2 },
              { case: { $eq: ['$landlordTreatment', 'fair'] }, then: 3 },
              { case: { $eq: ['$landlordTreatment', 'good'] }, then: 4 },
              { case: { $eq: ['$landlordTreatment', 'excellent'] }, then: 5 }
            ],
            default: 3
          }}},
          avgNeighbors: { $avg: { $switch: {
            branches: [
              { case: { $eq: ['$neighborRelations', 'very_poor'] }, then: 1 },
              { case: { $eq: ['$neighborRelations', 'poor'] }, then: 2 },
              { case: { $eq: ['$neighborRelations', 'fair'] }, then: 3 },
              { case: { $eq: ['$neighborRelations', 'good'] }, then: 4 },
              { case: { $eq: ['$neighborRelations', 'excellent'] }, then: 5 }
            ],
            default: 3
          }}},
          avgSecurity: { $avg: { $switch: {
            branches: [
              { case: { $eq: ['$areaSecurity', 'very_unsafe'] }, then: 1 },
              { case: { $eq: ['$areaSecurity', 'unsafe'] }, then: 2 },
              { case: { $eq: ['$areaSecurity', 'neutral'] }, then: 3 },
              { case: { $eq: ['$areaSecurity', 'safe'] }, then: 4 },
              { case: { $eq: ['$areaSecurity', 'very_safe'] }, then: 5 }
            ],
            default: 3
          }}}
        }
      }
    ]);

    return ok(res, {
      ...stats,
      averageRating: Number(stats.averageRating.toFixed(1)),
      recommendationPercentage: Number(stats.recommendationPercentage.toFixed(1)),
      ratingDistribution,
      categoryAverages: categoryAverages.length > 0 ? {
        condition: Number(categoryAverages[0].avgCondition.toFixed(1)),
        landlord: Number(categoryAverages[0].avgLandlord.toFixed(1)),
        neighbors: Number(categoryAverages[0].avgNeighbors.toFixed(1)),
        security: Number(categoryAverages[0].avgSecurity.toFixed(1))
      } : {
        condition: 0,
        landlord: 0,
        neighbors: 0,
        security: 0
      }
    });

  } catch (error) {
    logger.error('Error fetching address review stats:', error);
    return serverError(res, { message: 'Failed to fetch review statistics' });
  }
};

/**
 * Create a new review
 * POST /api/reviews
 */
export const createReview = async (req: Request, res: Response) => {
  try {
    const reviewData = req.body;
    
    // Get user ID from request (set by auth middleware)
    const oxyUserId = (req as any).user?.id || (req as any).user?._id || (req as any).userId;
    if (!oxyUserId) {
      return badRequest(res, { message: 'User authentication required' });
    }

    // Get the active profile for this user
    const { Profile } = require('../models');
    const { ProfileType } = require('@homiio/shared-types');
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    if (!activeProfile) {
      return badRequest(res, { message: 'No active profile found' });
    }

    // Only personal profiles can create reviews
    if (activeProfile.profileType !== ProfileType.PERSONAL) {
      return badRequest(res, { 
        message: 'Only personal profiles can create reviews. Agencies, businesses, and other profile types cannot create reviews.' 
      });
    }

    // Validate address exists
    if (!Types.ObjectId.isValid(reviewData.addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    const address = await Address.findById(reviewData.addressId);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    // Check if user already reviewed this address
    const existingReview = await Review.findOne({ 
      addressId: reviewData.addressId, 
      profileId: activeProfile._id
    });

    if (existingReview) {
      return badRequest(res, { message: 'You have already reviewed this address' });
    }

    // Create the review
    const review = new Review({
      ...reviewData,
      profileId: activeProfile._id,
      addressId: reviewData.addressId
    });

    await review.save();
    await review.populate('profileId', 'profileType personalProfile agencyProfile');

    logger.info(`New review created for address ${reviewData.addressId} by user ${activeProfile._id}`);
    return created(res, { review });

  } catch (error) {
    logger.error('Error creating review:', error);
    if (error.name === 'ValidationError') {
      return badRequest(res, { 
        message: 'Validation error', 
        errors: Object.values(error.errors).map((e: any) => e.message)
      });
    }
    return serverError(res, { message: 'Failed to create review' });
  }
};

/**
 * Get a specific review by ID
 * GET /api/reviews/:reviewId
 */
export const getReviewById = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const review = await Review.findById(reviewId)
      .populate('profileId', 'profileType personalProfile agencyProfile')
      .populate('addressId');

    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    return ok(res, { review });

  } catch (error) {
    logger.error('Error fetching review:', error);
    return serverError(res, { message: 'Failed to fetch review' });
  }
};

/**
 * Update a review
 * PUT /api/reviews/:reviewId
 */
export const updateReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const updateData = req.body;
    
    // Get user ID from request (set by auth middleware)
    const oxyUserId = (req as any).user?.id || (req as any).user?._id || (req as any).userId;
    if (!oxyUserId) {
      return badRequest(res, { message: 'User authentication required' });
    }

    // Get the active profile for this user
    const { Profile } = require('../models');
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    if (!activeProfile) {
      return badRequest(res, { message: 'No active profile found' });
    }

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    // Check if user owns this review
    if (review.profileId.toString() !== activeProfile._id.toString()) {
      return badRequest(res, { message: 'You can only update your own reviews' });
    }

    // Update the review
    Object.assign(review, updateData);
    await review.save();
    await review.populate('profileId', 'profileType personalProfile agencyProfile');

    logger.info(`Review ${reviewId} updated by user ${activeProfile._id}`);
    return ok(res, { review });

  } catch (error) {
    logger.error('Error updating review:', error);
    if (error.name === 'ValidationError') {
      return badRequest(res, { 
        message: 'Validation error', 
        errors: Object.values(error.errors).map((e: any) => e.message)
      });
    }
    return serverError(res, { message: 'Failed to update review' });
  }
};

/**
 * Delete a review
 * DELETE /api/reviews/:reviewId
 */
export const deleteReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    
    // Get user ID from request (set by auth middleware)
    const oxyUserId = (req as any).user?.id || (req as any).user?._id || (req as any).userId;
    if (!oxyUserId) {
      return badRequest(res, { message: 'User authentication required' });
    }

    // Get the active profile for this user
    const { Profile } = require('../models');
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    if (!activeProfile) {
      return badRequest(res, { message: 'No active profile found' });
    }

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    // Check if user owns this review
    if (review.profileId.toString() !== activeProfile._id.toString()) {
      return badRequest(res, { message: 'You can only delete your own reviews' });
    }

    await Review.findByIdAndDelete(reviewId);

    logger.info(`Review ${reviewId} deleted by user ${activeProfile._id}`);
    return ok(res, { message: 'Review deleted successfully' });

  } catch (error) {
    logger.error('Error deleting review:', error);
    return serverError(res, { message: 'Failed to delete review' });
  }
};

/**
 * Get profile's reviews
 * GET /api/reviews/profile/:profileId
 */
export const getUserReviews = async (req: Request, res: Response) => {
  try {
    const { profileId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!Types.ObjectId.isValid(profileId)) {
      return badRequest(res, { message: 'Invalid profile ID' });
    }

    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);
    const skip = (pageNumber - 1) * limitNumber;

    const reviews = await Review.find({ profileId })
      .populate('addressId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean();

    const totalReviews = await Review.countDocuments({ profileId });

    return ok(res, {
      reviews,
      pagination: {
        currentPage: pageNumber,
        totalPages: Math.ceil(totalReviews / limitNumber),
        totalReviews,
        limit: limitNumber
      }
    });

  } catch (error) {
    logger.error('Error fetching user reviews:', error);
    return serverError(res, { message: 'Failed to fetch user reviews' });
  }
};
