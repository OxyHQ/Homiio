/**
 * Address Controller
 * Handles CRUD operations for addresses
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';

import { Address } from '../models';
import { getErrorName, getValidationMessages } from '../utils/errors';

/**
 * Response helpers
 */
const ok = (res: Response, data: any) => res.status(200).json({ success: true, ...data });
const created = (res: Response, data: any) => res.status(201).json({ success: true, ...data });
const badRequest = (res: Response, data: any) => res.status(400).json({ success: false, ...data });
const notFound = (res: Response, data: any) => res.status(404).json({ success: false, ...data });
const serverError = (res: Response, data: any) => res.status(500).json({ success: false, ...data });

const logger = {
  info: console.log,
  error: console.error,
  warn: console.warn
};

/**
 * Get address by ID
 * GET /api/addresses/:id
 */
export const getAddressById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    // Deep-populate the geo refs so the resolved city/region/country/
    // neighborhood NAMES can be attached (geo is relational; names live on the
    // geo docs). `.lean()` so the serializer can decorate the plain object.
    const address = await Address.findById(id)
      .populate([
        { path: 'cityId', select: 'name' },
        { path: 'regionId', select: 'name' },
        { path: 'countryId', select: 'name code' },
        { path: 'neighborhoodId', select: 'name' },
      ])
      .lean();

    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    const { attachAddressGeoNames } = require('../services/propertyAddressSerializer');
    attachAddressGeoNames(address);

    return ok(res, { address });

  } catch (error) {
    logger.error('Error fetching address:', error);
    return serverError(res, { message: 'Failed to fetch address' });
  }
};

/**
 * Search addresses
 * GET /api/addresses/search
 */
export const searchAddresses = async (req: Request, res: Response) => {
  try {
    const { query, limit = 10, page = 1 } = req.query;

    if (!query) {
      return badRequest(res, { message: 'Search query is required' });
    }

    const skip = (Number(page) - 1) * Number(limit);

    // Geo is relational: match the building-level `street` directly, and resolve
    // the term against the canonical City/Region/Neighborhood collections to
    // include addresses in any matching place (no free-text city on the Address).
    const { resolveGeoFilterAddressIds } = require('../services/geoQueryService');
    const [byCity, byRegion, byNeighborhood] = await Promise.all([
      resolveGeoFilterAddressIds({ city: String(query) }),
      resolveGeoFilterAddressIds({ state: String(query) }),
      resolveGeoFilterAddressIds({ neighborhood: String(query) }),
    ]);
    const geoAddressIds = [...(byCity ?? []), ...(byRegion ?? []), ...(byNeighborhood ?? [])];

    const searchFilter = {
      $or: [
        { street: { $regex: query, $options: 'i' } },
        ...(geoAddressIds.length > 0 ? [{ _id: { $in: geoAddressIds } }] : []),
      ],
    };

    const addresses = await Address.find(searchFilter)
      .populate([
        { path: 'cityId', select: 'name' },
        { path: 'regionId', select: 'name' },
        { path: 'countryId', select: 'name code' },
      ])
      .limit(Number(limit))
      .skip(skip)
      .sort({ createdAt: -1 });

    const totalCount = await Address.countDocuments(searchFilter);

    return ok(res, {
      addresses,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(totalCount / Number(limit)),
        totalItems: totalCount,
        hasNextPage: skip + addresses.length < totalCount,
        hasPrevPage: Number(page) > 1
      }
    });

  } catch (error) {
    logger.error('Error searching addresses:', error);
    return serverError(res, { message: 'Failed to search addresses' });
  }
};

/**
 * Create a new address
 * POST /api/addresses
 */
export const createAddress = async (req: Request, res: Response) => {
  try {
    const addressData = req.body;

    // Validate required fields
    if (!addressData.street || !addressData.city || !addressData.country) {
      return badRequest(res, {
        message: 'Street, city, and country are required'
      });
    }
    if (!addressData.coordinates?.coordinates) {
      return badRequest(res, { message: 'Coordinates are required to resolve the address location' });
    }

    // Geo is relational: `findOrCreateCanonical` resolves the country/region/
    // city/neighborhood id chain from the coordinates/place names and dedupes
    // the building. City/state/country NAMES are inputs only — never persisted.
    const address = await Address.findOrCreateCanonical(addressData);

    logger.info(`Address resolved: ${address._id}`);
    return created(res, { address });

  } catch (error) {
    logger.error('Error creating address:', error);
    if (getErrorName(error) === 'ValidationError') {
      return badRequest(res, {
        message: 'Validation error',
        errors: getValidationMessages(error)
      });
    }
    return serverError(res, { message: 'Failed to create address' });
  }
};

/**
 * Update an address
 * PUT /api/addresses/:id
 */
export const updateAddress = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!Types.ObjectId.isValid(id)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    const address = await Address.findById(id);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    // Geo is relational and resolved at creation time; updates here cover only
    // BUILDING-level fields. Reject attempts to mutate the geo references or the
    // resolved-only NAME aliases via this endpoint (re-resolve via create flow).
    const FORBIDDEN_GEO_KEYS = ['city', 'state', 'country', 'neighborhood', 'countryId', 'regionId', 'cityId', 'neighborhoodId'];
    for (const key of FORBIDDEN_GEO_KEYS) {
      delete updateData[key];
    }

    const updatedAddress = await Address.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    logger.info(`Address ${id} updated`);
    return ok(res, { address: updatedAddress });

  } catch (error) {
    logger.error('Error updating address:', error);
    if (getErrorName(error) === 'ValidationError') {
      return badRequest(res, { 
        message: 'Validation error', 
        errors: getValidationMessages(error)
      });
    }
    return serverError(res, { message: 'Failed to update address' });
  }
};

/**
 * Delete an address
 * DELETE /api/addresses/:id
 */
export const deleteAddress = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    const address = await Address.findById(id);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    await Address.findByIdAndDelete(id);

    logger.info(`Address ${id} deleted`);
    return ok(res, { message: 'Address deleted successfully' });

  } catch (error) {
    logger.error('Error deleting address:', error);
    return serverError(res, { message: 'Failed to delete address' });
  }
};

/**
 * Get addresses near a location
 * GET /api/addresses/nearby
 */
export const getNearbyAddresses = async (req: Request, res: Response) => {
  try {
    const { lat, lng, radius = 1000, limit = 20 } = req.query;

    if (!lat || !lng) {
      return badRequest(res, { message: 'Latitude and longitude are required' });
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);
    const radiusInMeters = parseInt(radius as string);

    if (isNaN(latitude) || isNaN(longitude)) {
      return badRequest(res, { message: 'Invalid coordinates' });
    }

    const addresses = await Address.find({
      coordinates: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude] // GeoJSON format: [lng, lat]
          },
          $maxDistance: radiusInMeters
        }
      }
    }).limit(Number(limit));

    return ok(res, { addresses });

  } catch (error) {
    logger.error('Error finding nearby addresses:', error);
    return serverError(res, { message: 'Failed to find nearby addresses' });
  }
};
