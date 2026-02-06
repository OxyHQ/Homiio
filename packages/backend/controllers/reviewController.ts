/**
 * Review Controller
 * Handles hierarchical address review operations (STREET → BUILDING → UNIT)
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { ProfileType } from '@homiio/shared-types';
import { Review } from '../models/Review';
const { Address, Profile } = require('../models');

/**
 * Response helpers
 */
const ok = (res: Response, data: any) => res.status(200).json({ success: true, ...data });
const created = (res: Response, data: any) => res.status(201).json({ success: true, ...data });
const badRequest = (res: Response, data: any) => res.status(400).json({ success: false, ...data });
const notFound = (res: Response, data: any) => res.status(404).json({ success: false, ...data });
const serverError = (res: Response, data: any) => res.status(500).json({ success: false, ...data });

const logger = {
  info: (message: string, data?: any) => {},
  error: (message: string, error?: any) => {}
};

/**
 * Get reviews for an address with hierarchical context
 * GET /api/reviews/address/:addressId
 */
export const getReviewsByAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!Types.ObjectId.isValid(addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    // Check if address exists and determine its level
    const address = await Address.findById(addressId);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    const addressLevel = address.getAddressLevel();
    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);

    let responseData: any = {};

    switch (addressLevel) {
      case 'UNIT':
        // For UNIT level: show unit reviews + building summary
        const unitData = await Review.getUnitViewData(addressId);
        responseData = {
          level: 'UNIT',
          unitReviews: unitData.unitReviews.slice((pageNumber - 1) * limitNumber, pageNumber * limitNumber),
          buildingSummary: unitData.buildingSummary,
          totalReviews: unitData.unitReviews.length,
          pagination: {
            currentPage: pageNumber,
            totalPages: Math.ceil(unitData.unitReviews.length / limitNumber),
            limit: limitNumber
          }
        };
        break;

      case 'BUILDING':
        // For BUILDING level: show building reviews + all unit reviews
        const buildingData = await Review.getBuildingViewData(addressId);
        const allReviews = [...buildingData.buildingReviews, ...buildingData.unitReviews];
        responseData = {
          level: 'BUILDING',
          buildingReviews: buildingData.buildingReviews,
          unitReviews: buildingData.unitReviews.slice((pageNumber - 1) * limitNumber, pageNumber * limitNumber),
          aggregatedStats: buildingData.aggregatedStats,
          totalReviews: allReviews.length,
          pagination: {
            currentPage: pageNumber,
            totalPages: Math.ceil(allReviews.length / limitNumber),
            limit: limitNumber
          }
        };
        break;

      case 'STREET':
        // For STREET level: show aggregated stats across all buildings
        const streetData = await Review.getStreetViewData(addressId);
        responseData = {
          level: 'STREET',
          aggregatedStats: streetData.aggregatedStats,
          buildingCount: streetData.buildingCount,
          totalReviews: streetData.aggregatedStats.totalReviews
        };
        break;

      default:
        return badRequest(res, { message: 'Invalid address level for reviews' });
    }

    return ok(res, responseData);

  } catch (error) {
    logger.error('Error fetching hierarchical reviews:', error);
    return serverError(res, { message: 'Failed to fetch reviews' });
  }
};

/**
 * Get hierarchical review statistics for an address
 * GET /api/reviews/address/:addressId/stats
 */
export const getAddressReviewStats = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;

    if (!Types.ObjectId.isValid(addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    // Check if address exists and determine its level
    const address = await Address.findById(addressId);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    const addressLevel = address.getAddressLevel();
    let statsData: any = {};

    switch (addressLevel) {
      case 'UNIT':
        const unitData = await Review.getUnitViewData(addressId);
        statsData = {
          level: 'UNIT',
          unitStats: {
            averageRating: unitData.unitReviews.length > 0 
              ? unitData.unitReviews.reduce((sum, r) => sum + r.rating, 0) / unitData.unitReviews.length 
              : 0,
            totalReviews: unitData.unitReviews.length,
            recommendationPercentage: unitData.unitReviews.length > 0
              ? (unitData.unitReviews.filter(r => r.recommendation).length / unitData.unitReviews.length) * 100
              : 0
          },
          buildingSummary: unitData.buildingSummary
        };
        break;

      case 'BUILDING':
        const buildingData = await Review.getBuildingViewData(addressId);
        statsData = {
          level: 'BUILDING',
          aggregatedStats: buildingData.aggregatedStats,
          buildingReviewCount: buildingData.buildingReviews.length,
          unitReviewCount: buildingData.unitReviews.length
        };
        break;

      case 'STREET':
        const streetData = await Review.getStreetViewData(addressId);
        statsData = {
          level: 'STREET',
          aggregatedStats: streetData.aggregatedStats,
          buildingCount: streetData.buildingCount
        };
        break;

      default:
        return badRequest(res, { message: 'Invalid address level for review stats' });
    }

    return ok(res, { stats: statsData });

  } catch (error) {
    logger.error('Error fetching hierarchical review stats:', error);
    return serverError(res, { message: 'Failed to fetch review statistics' });
  }
};

/**
 * Create a new review
 * POST /api/reviews
 */
export const createReview = async (req: Request, res: Response) => {
  try {
    const { address: addressData, ...reviewData } = req.body;
    
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

    // Validate address data
    if (!addressData || !addressData.street || !addressData.city || !addressData.postal_code || !addressData.country) {
      return badRequest(res, { message: 'Address information is required (street, city, postal_code, country)' });
    }

    // Validate required review fields
    if (!reviewData.opinion || reviewData.opinion.trim().length < 10) {
      return badRequest(res, { message: 'Opinion must be at least 10 characters long' });
    }

    // Try to find existing address or create new one
    let address;
    
    // Create normalized address for lookup
    const normalizedAddress = {
      street: addressData.street.trim(),
      city: addressData.city.trim(),
      state: addressData.state?.trim() || '',
      postal_code: addressData.postal_code.trim(),
      country: addressData.country.trim(),
      number: addressData.number?.trim() || '',
      building_name: addressData.building_name?.trim() || '',
      floor: addressData.floor?.trim() || '',
      unit: addressData.unit?.trim() || ''
    };

    // Check if address already exists
    // We'll look for an exact match on key fields, checking both new and legacy field names
    address = await Address.findOne({
      $or: [
        // Modern field names
        {
          street: normalizedAddress.street,
          city: normalizedAddress.city,
          postal_code: normalizedAddress.postal_code,
          country: normalizedAddress.country,
          ...(normalizedAddress.state && { state: normalizedAddress.state }),
          ...(normalizedAddress.number && { number: normalizedAddress.number }),
          ...(normalizedAddress.building_name && { building_name: normalizedAddress.building_name }),
          ...(normalizedAddress.floor && { floor: normalizedAddress.floor }),
          ...(normalizedAddress.unit && { unit: normalizedAddress.unit })
        },
        // Legacy field names (zipCode instead of postal_code)
        {
          street: normalizedAddress.street,
          city: normalizedAddress.city,
          zipCode: normalizedAddress.postal_code,  // Check legacy zipCode field
          country: normalizedAddress.country,
          ...(normalizedAddress.state && { state: normalizedAddress.state }),
          ...(normalizedAddress.number && { number: normalizedAddress.number }),
          ...(normalizedAddress.building_name && { building_name: normalizedAddress.building_name }),
          ...(normalizedAddress.floor && { floor: normalizedAddress.floor }),
          ...(normalizedAddress.unit && { unit: normalizedAddress.unit })
        }
      ]
    });

    if (!address) {
      // Create new address
      const addressToCreate = {
        street: normalizedAddress.street,
        city: normalizedAddress.city,
        state: normalizedAddress.state || undefined,
        postal_code: normalizedAddress.postal_code,
        country: normalizedAddress.country,
        countryCode: 'ES', // Default for now, could be determined from country name
        ...(normalizedAddress.number && { number: normalizedAddress.number }),
        ...(normalizedAddress.building_name && { building_name: normalizedAddress.building_name }),
        ...(normalizedAddress.floor && { floor: normalizedAddress.floor }),
        ...(normalizedAddress.unit && { unit: normalizedAddress.unit }),
        address_lines: [
          normalizedAddress.street,
          ...(normalizedAddress.number ? [normalizedAddress.number] : []),
          ...(normalizedAddress.building_name ? [normalizedAddress.building_name] : [])
        ].filter(Boolean),
        // Use coordinates from request if available, otherwise default coordinates
        coordinates: {
          type: 'Point',
          coordinates: addressData.latitude && addressData.longitude 
            ? [parseFloat(addressData.longitude), parseFloat(addressData.latitude)] 
            : [0, 0] // [longitude, latitude]
        }
      };

      try {
        // Create address directly
        address = new Address(addressToCreate);
        await address.save();
        logger.info('Created new address', { addressId: address._id });
      } catch (error: any) {
        // Handle duplicate key error (E11000) by trying to find the existing address
        if (error.code === 11000) {
          logger.info('Address already exists (caught duplicate key error), attempting to find it');
          
          // Try to find the address again with broader search criteria
          address = await Address.findOne({
            street: normalizedAddress.street,
            city: normalizedAddress.city,
            state: normalizedAddress.state,
            $or: [
              { postal_code: normalizedAddress.postal_code },
              { zipCode: normalizedAddress.postal_code }  // Legacy field
            ]
          });
          
          if (!address) {
            // If we still can't find it, throw the original error
            throw error;
          }
          
          logger.info('Found existing address after duplicate key error', { addressId: address._id });
        } else {
          throw error;
        }
      }
    } else {
      logger.info('Using existing address', { addressId: address._id });
    }

    const addressLevel = address.getAddressLevel();
    
    // Reviews can only be created at BUILDING or UNIT level
    if (!['BUILDING', 'UNIT'].includes(addressLevel)) {
      return badRequest(res, { 
        message: 'Reviews can only be created at BUILDING or UNIT level addresses' 
      });
    }

    // Check if user already has a review for this address
    const existingReview = await Review.findOne({ 
      profileId: activeProfile._id, 
      addressId: address._id 
    });
    
    if (existingReview) {
      return badRequest(res, { message: 'You have already reviewed this address' });
    }

    // Set up hierarchical address references based on the level
    let hierarchicalData: any = {
      addressLevel,
      addressId: address._id
    };

    if (addressLevel === 'UNIT') {
      // For UNIT level, we need to find/create the building and street levels
      const buildingLevelData = address.createBuildingLevel();
      let buildingLevel = await Address.findOne(buildingLevelData);
      if (!buildingLevel) {
        buildingLevel = await Address.create(buildingLevelData);
      }
      
      const streetLevelData = address.createStreetLevel();
      let streetLevel = await Address.findOne(streetLevelData);
      if (!streetLevel) {
        streetLevel = await Address.create(streetLevelData);
      }
      
      hierarchicalData.unitLevelId = address._id;
      hierarchicalData.buildingLevelId = buildingLevel._id;
      hierarchicalData.streetLevelId = streetLevel._id;
    } else if (addressLevel === 'BUILDING') {
      // For BUILDING level, we need to find/create the street level
      const streetLevelData = address.createStreetLevel();
      let streetLevel = await Address.findOne(streetLevelData);
      if (!streetLevel) {
        streetLevel = await Address.create(streetLevelData);
      }
      
      hierarchicalData.buildingLevelId = address._id;
      hierarchicalData.streetLevelId = streetLevel._id;
    }

    // Create the review with hierarchical data
    const review = new Review({
      ...reviewData,
      ...hierarchicalData,
      profileId: activeProfile._id
    });

    await review.save();

    // Populate the saved review for response
    const populatedReview = await Review.findById(review._id)
      .populate('profileId', 'profileType personalProfile isAnonymous')
      .populate('addressId', 'street city state postal_code country fullAddress')
      .lean();

    logger.info('Review created successfully', { reviewId: review._id, addressId: address._id });
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
