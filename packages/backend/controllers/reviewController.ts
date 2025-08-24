/**
 * Review Controller
 * Handles CRUD operations for address reviews
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { ProfileType } from '@homiio/shared-types';
const { Review, Address, Profile } = require('../models');

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
      .sort({ createdAt: -1 })
      .populate('addressId', 'street city state postal_code country countryCode fullAddress')
      .populate('profileId', 'personalProfile.firstName personalProfile.lastName profileType')

    const totalReviews = await Review.countDocuments({ addressId });
    const stats = await Review.getAverageRatingForAddress(addressId);

    return ok(res, {
      reviews,
      pagination: {
        currentPage: pageNumber,
        totalPages: Math.ceil(totalReviews / limitNumber),
        totalReviews,
        limit: limitNumber
      },
      stats: {
        avgRating: stats.avgRating || 0,
        count: stats.count || 0,
        recommendationRate: (stats.recommendationRate || 0) * 100
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

    const stats = await Review.getAverageRatingForAddress(addressId);
    
    // Get rating distribution
    const ratingDistribution = await Review.aggregate([
      { $match: { addressId: new Types.ObjectId(addressId) } },
      {
        $addFields: {
          overallRating: {
            $avg: [
              '$apartmentSize', '$apartmentKitchen', '$apartmentBathroom',
              '$apartmentBedroom', '$apartmentStorage', '$apartmentFurnishing',
              '$apartmentInternet', '$apartmentCellReception',
              '$communityMaintenance', '$communityCleanliness', '$communityManagement',
              '$communityAmenities', '$communityParking', '$communitySafety',
              '$landlordCommunication', '$landlordFairness', '$landlordMaintenance'
            ]
          }
        }
      },
      {
        $group: {
          _id: { $ceil: '$overallRating' },
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
          avgApartment: { $avg: { $avg: ['$apartmentSize', '$apartmentKitchen', '$apartmentBathroom', '$apartmentBedroom', '$apartmentStorage', '$apartmentFurnishing'] }},
          avgCommunity: { $avg: { $avg: ['$communityMaintenance', '$communityCleanliness', '$communityManagement', '$communityAmenities', '$communityParking', '$communitySafety'] }},
          avgLandlord: { $avg: { $avg: ['$landlordCommunication', '$landlordFairness', '$landlordMaintenance'] }},
          avgArea: { $avg: { $avg: ['$areaTransport', '$areaShopping', '$areaEducation'] }}
        }
      }
    ]);

    return ok(res, {
      ...stats,
      avgRating: stats.avgRating || 0,
      recommendationRate: (stats.recommendationRate || 0) * 100,
      ratingDistribution,
      categoryAverages: categoryAverages.length > 0 ? {
        apartment: Number((categoryAverages[0].avgApartment || 0).toFixed(1)),
        community: Number((categoryAverages[0].avgCommunity || 0).toFixed(1)),
        landlord: Number((categoryAverages[0].avgLandlord || 0).toFixed(1)),
        area: Number((categoryAverages[0].avgArea || 0).toFixed(1))
      } : {
        apartment: 0,
        community: 0,
        landlord: 0,
        area: 0
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
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    if (!activeProfile) {
      return badRequest(res, { message: 'No active profile found' });
    }

    // Validate that only personal profiles can create reviews
    if (activeProfile.profileType !== ProfileType.PERSONAL) {
      return badRequest(res, { 
        message: 'Only personal profiles can create reviews. Agencies and businesses cannot create reviews.' 
      });
    }

    // Validate required fields
    if (!reviewData.addressId) {
      return badRequest(res, { message: 'Address ID is required' });
    }

    if (!reviewData.opinion || reviewData.opinion.trim().length < 10) {
      return badRequest(res, { message: 'Opinion must be at least 10 characters long' });
    }

    // Validate addressId
    if (!Types.ObjectId.isValid(reviewData.addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    // Check if address exists
    const address = await Address.findById(reviewData.addressId);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    // Check if user already has a review for this address
    const existingReview = await Review.findOne({ 
      profileId: activeProfile._id, 
      addressId: reviewData.addressId 
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

    // Populate the saved review for response
    const populatedReview = await Review.findById(review._id)
      .populate('profileId', 'profileType personalProfile isAnonymous')
      .populate('addressId', 'street city state zipCode country fullAddress')
      .lean();

    logger.info('Review created successfully', { reviewId: review._id, addressId: reviewData.addressId });
    return created(res, { review: populatedReview });

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
