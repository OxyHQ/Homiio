/**
 * Address Controller
 * Handles CRUD operations for addresses
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';

const { Address } = require('../models');

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

    const address = await Address.findById(id);
    
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

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

    // Search addresses using text search or regex
    const addresses = await Address.find({
      $or: [
        { street: { $regex: query, $options: 'i' } },
        { city: { $regex: query, $options: 'i' } },
        { neighborhood: { $regex: query, $options: 'i' } },
        { fullAddress: { $regex: query, $options: 'i' } }
      ]
    })
    .limit(Number(limit))
    .skip(skip)
    .sort({ createdAt: -1 });

    const totalCount = await Address.countDocuments({
      $or: [
        { street: { $regex: query, $options: 'i' } },
        { city: { $regex: query, $options: 'i' } },
        { neighborhood: { $regex: query, $options: 'i' } },
        { fullAddress: { $regex: query, $options: 'i' } }
      ]
    });

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

    // Create full address string
    const fullAddressParts = [
      addressData.street,
      addressData.neighborhood,
      addressData.city,
      addressData.state,
      addressData.zipCode,
      addressData.country
    ].filter(Boolean);
    
    addressData.fullAddress = fullAddressParts.join(', ');
    addressData.location = `${addressData.city}, ${addressData.country}`;

    const address = new Address(addressData);
    await address.save();

    logger.info(`New address created: ${address._id}`);
    return created(res, { address });

  } catch (error) {
    logger.error('Error creating address:', error);
    if (error.name === 'ValidationError') {
      return badRequest(res, { 
        message: 'Validation error', 
        errors: Object.values(error.errors).map((e: any) => e.message)
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

    // Update full address string if address components changed
    if (updateData.street || updateData.city || updateData.country || 
        updateData.neighborhood || updateData.state || updateData.zipCode) {
      
      const fullAddressParts = [
        updateData.street || address.street,
        updateData.neighborhood || address.neighborhood,
        updateData.city || address.city,
        updateData.state || address.state,
        updateData.zipCode || address.zipCode,
        updateData.country || address.country
      ].filter(Boolean);
      
      updateData.fullAddress = fullAddressParts.join(', ');
      updateData.location = `${updateData.city || address.city}, ${updateData.country || address.country}`;
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
    if (error.name === 'ValidationError') {
      return badRequest(res, { 
        message: 'Validation error', 
        errors: Object.values(error.errors).map((e: any) => e.message)
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
