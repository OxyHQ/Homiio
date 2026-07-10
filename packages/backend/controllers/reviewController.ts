/**
 * Review Controller
 * Handles hierarchical address review operations (STREET → BUILDING → UNIT)
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Review } from '../models/Review';
import { forwardGeocode } from '../services/geocodingService';
import { Address } from '../models';
import { getErrorName, getValidationMessages } from '../utils/errors';
import { getRequiredOxyUserId } from '@oxyhq/core/server';

const ok = (res: Response, data: Record<string, unknown>) => res.status(200).json({ success: true, ...data });
const created = (res: Response, data: Record<string, unknown>) => res.status(201).json({ success: true, ...data });
const badRequest = (res: Response, data: Record<string, unknown>) => res.status(400).json({ success: false, ...data });
const notFound = (res: Response, data: Record<string, unknown>) => res.status(404).json({ success: false, ...data });
const serverError = (res: Response, data: Record<string, unknown>) => res.status(500).json({ success: false, ...data });

const logger = {
  info: (_message: string, _data?: unknown) => {},
  error: (_message: string, _error?: unknown) => {},
};

export const getReviewsByAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!Types.ObjectId.isValid(addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    const address = await Address.findById(addressId);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    const addressLevel = address.getAddressLevel();
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    let responseData: Record<string, unknown> = {};

    switch (addressLevel) {
      case 'UNIT': {
        const unitData = await Review.getUnitViewData(addressId);
        responseData = {
          level: 'UNIT',
          unitReviews: unitData.unitReviews.slice((pageNumber - 1) * limitNumber, pageNumber * limitNumber),
          buildingSummary: unitData.buildingSummary,
          totalReviews: unitData.unitReviews.length,
          pagination: {
            currentPage: pageNumber,
            totalPages: Math.ceil(unitData.unitReviews.length / limitNumber),
            limit: limitNumber,
          },
        };
        break;
      }
      case 'BUILDING': {
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
            limit: limitNumber,
          },
        };
        break;
      }
      case 'STREET': {
        const streetData = await Review.getStreetViewData(addressId);
        responseData = {
          level: 'STREET',
          aggregatedStats: streetData.aggregatedStats,
          buildingCount: streetData.buildingCount,
          totalReviews: streetData.aggregatedStats.totalReviews,
        };
        break;
      }
      default:
        return badRequest(res, { message: 'Invalid address level for reviews' });
    }

    return ok(res, responseData);
  } catch (error) {
    logger.error('Error fetching hierarchical reviews:', error);
    return serverError(res, { message: 'Failed to fetch reviews' });
  }
};

export const getAddressReviewStats = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;

    if (!Types.ObjectId.isValid(addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    const address = await Address.findById(addressId);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    const addressLevel = address.getAddressLevel();
    let statsData: Record<string, unknown> = {};

    switch (addressLevel) {
      case 'UNIT': {
        const unitData = await Review.getUnitViewData(addressId);
        statsData = {
          level: 'UNIT',
          unitStats: {
            averageRating: unitData.unitReviews.length > 0
              ? unitData.unitReviews.reduce((sum, r) => sum + r.rating, 0) / unitData.unitReviews.length
              : 0,
            totalReviews: unitData.unitReviews.length,
            recommendationPercentage: unitData.unitReviews.length > 0
              ? (unitData.unitReviews.filter((r) => r.recommendation).length / unitData.unitReviews.length) * 100
              : 0,
          },
          buildingSummary: unitData.buildingSummary,
        };
        break;
      }
      case 'BUILDING': {
        const buildingData = await Review.getBuildingViewData(addressId);
        statsData = {
          level: 'BUILDING',
          aggregatedStats: buildingData.aggregatedStats,
          buildingReviewCount: buildingData.buildingReviews.length,
          unitReviewCount: buildingData.unitReviews.length,
        };
        break;
      }
      case 'STREET': {
        const streetData = await Review.getStreetViewData(addressId);
        statsData = {
          level: 'STREET',
          aggregatedStats: streetData.aggregatedStats,
          buildingCount: streetData.buildingCount,
        };
        break;
      }
      default:
        return badRequest(res, { message: 'Invalid address level for review stats' });
    }

    return ok(res, { stats: statsData });
  } catch (error) {
    logger.error('Error fetching hierarchical review stats:', error);
    return serverError(res, { message: 'Failed to fetch review statistics' });
  }
};

export const createReview = async (req: Request, res: Response) => {
  try {
    const { address: addressData, ...reviewData } = req.body;
    const oxyUserId = getRequiredOxyUserId(req);

    if (!addressData || !addressData.street || !addressData.city || !addressData.postal_code || !addressData.country) {
      return badRequest(res, { message: 'Address information is required (street, city, postal_code, country)' });
    }

    if (!reviewData.opinion || reviewData.opinion.trim().length < 10) {
      return badRequest(res, { message: 'Opinion must be at least 10 characters long' });
    }

    let coordinates = addressData.latitude && addressData.longitude
      ? { type: 'Point' as const, coordinates: [parseFloat(addressData.longitude), parseFloat(addressData.latitude)] as [number, number] }
      : undefined;

    if (!coordinates) {
      const query = [addressData.street, addressData.number, addressData.city, addressData.state, addressData.postal_code, addressData.country]
        .filter(Boolean)
        .join(', ');
      const geocoded = await forwardGeocode(query);
      if (!geocoded.success || !geocoded.data?.coordinates) {
        return badRequest(res, { message: 'Could not resolve coordinates for the address; please include latitude and longitude' });
      }
      coordinates = { type: 'Point', coordinates: geocoded.data.coordinates };
    }

    const address = await Address.findOrCreateCanonical({
      street: addressData.street.trim(),
      number: addressData.number?.trim() || undefined,
      building_name: addressData.building_name?.trim() || undefined,
      floor: addressData.floor?.trim() || undefined,
      unit: addressData.unit?.trim() || undefined,
      postal_code: addressData.postal_code.trim(),
      city: addressData.city.trim(),
      state: addressData.state?.trim() || undefined,
      country: addressData.country.trim(),
      countryCode: addressData.countryCode,
      neighborhood: addressData.neighborhood?.trim() || undefined,
      coordinates,
    });

    const addressLevel = address.getAddressLevel();

    if (!['BUILDING', 'UNIT'].includes(addressLevel)) {
      return badRequest(res, { message: 'Reviews can only be created at BUILDING or UNIT level addresses' });
    }

    const existingReview = await Review.findOne({
      oxyUserId,
      addressId: address._id,
    });

    if (existingReview) {
      return badRequest(res, { message: 'You have already reviewed this address' });
    }

    const hierarchicalData: Record<string, unknown> = {
      addressLevel,
      addressId: address._id,
    };

    if (addressLevel === 'UNIT') {
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
      const streetLevelData = address.createStreetLevel();
      let streetLevel = await Address.findOne(streetLevelData);
      if (!streetLevel) {
        streetLevel = await Address.create(streetLevelData);
      }

      hierarchicalData.buildingLevelId = address._id;
      hierarchicalData.streetLevelId = streetLevel._id;
    }

    const review = new Review({
      ...reviewData,
      ...hierarchicalData,
      oxyUserId,
    });

    await review.save();

    const populatedReview = await Review.findById(review._id)
      .populate({
        path: 'addressId',
        select: 'street postal_code countryCode cityId regionId countryId neighborhoodId coordinates',
        populate: [
          { path: 'cityId', select: 'name' },
          { path: 'regionId', select: 'name' },
          { path: 'countryId', select: 'name code' },
          { path: 'neighborhoodId', select: 'name' },
        ],
      })
      .lean();

    return created(res, { review: populatedReview });
  } catch (error) {
    logger.error('Error creating review:', error);
    if (getErrorName(error) === 'ValidationError') {
      return badRequest(res, {
        message: 'Validation error',
        errors: getValidationMessages(error),
      });
    }
    return serverError(res, { message: 'Failed to create review' });
  }
};

export const getReviewById = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const review = await Review.findById(reviewId).populate('addressId');

    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    return ok(res, { review });
  } catch (error) {
    logger.error('Error fetching review:', error);
    return serverError(res, { message: 'Failed to fetch review' });
  }
};

export const updateReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const updateData = req.body;
    const oxyUserId = getRequiredOxyUserId(req);

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    if (review.oxyUserId !== oxyUserId) {
      return badRequest(res, { message: 'You can only update your own reviews' });
    }

    Object.assign(review, updateData);
    await review.save();

    return ok(res, { review });
  } catch (error) {
    logger.error('Error updating review:', error);
    if (getErrorName(error) === 'ValidationError') {
      return badRequest(res, {
        message: 'Validation error',
        errors: getValidationMessages(error),
      });
    }
    return serverError(res, { message: 'Failed to update review' });
  }
};

export const deleteReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const oxyUserId = getRequiredOxyUserId(req);

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    if (review.oxyUserId !== oxyUserId) {
      return badRequest(res, { message: 'You can only delete your own reviews' });
    }

    await Review.findByIdAndDelete(reviewId);

    return ok(res, { message: 'Review deleted successfully' });
  } catch (error) {
    logger.error('Error deleting review:', error);
    return serverError(res, { message: 'Failed to delete review' });
  }
};

export const getUserReviews = async (req: Request, res: Response) => {
  try {
    const { oxyUserId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!oxyUserId) {
      return badRequest(res, { message: 'Oxy user id is required' });
    }

    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);
    const skip = (pageNumber - 1) * limitNumber;

    const reviews = await Review.find({ oxyUserId })
      .populate('addressId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean();

    const totalReviews = await Review.countDocuments({ oxyUserId });

    return ok(res, {
      reviews,
      pagination: {
        currentPage: pageNumber,
        totalPages: Math.ceil(totalReviews / limitNumber),
        totalReviews,
        limit: limitNumber,
      },
    });
  } catch (error) {
    logger.error('Error fetching user reviews:', error);
    return serverError(res, { message: 'Failed to fetch user reviews' });
  }
};
