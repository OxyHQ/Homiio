/**
 * Geocoding Controller
 * Handles geocoding-related API endpoints
 */

import { Request, Response, NextFunction } from 'express';
import { reverseGeocode, forwardGeocode } from '../services/geocodingService';
import { successResponse, AppError } from '../middlewares/errorHandler';

class GeocodingController {
  /**
   * Reverse geocode coordinates to get address
   * GET /api/geocoding/reverse
   */
  async reverseGeocode(req: Request, res: Response, next: NextFunction) {
    try {
      const { longitude, latitude } = req.query;

      // Validate required parameters
      if (!longitude || !latitude) {
        return next(
          new AppError(
            'Longitude and latitude are required',
            400,
            'MISSING_PARAMETERS'
          )
        );
      }

      // Parse and validate coordinates
      const lng = parseFloat(longitude as string);
      const lat = parseFloat(latitude as string);

      if (isNaN(lng) || isNaN(lat)) {
        return next(
          new AppError(
            'Invalid coordinates provided',
            400,
            'INVALID_COORDINATES'
          )
        );
      }

      // Perform reverse geocoding
      const result = await reverseGeocode(lng, lat);

      if (!result.success) {
        return next(
          new AppError(
            result.error || 'Geocoding failed',
            400,
            'GEOCODING_FAILED'
          )
        );
      }

      res.json(successResponse(result.data, 'Address found successfully'));

    } catch (error) {
      next(error);
    }
  }

  /**
   * Forward geocode address to get coordinates
   * GET /api/geocoding/forward
   */
  async forwardGeocode(req: Request, res: Response, next: NextFunction) {
    try {
      const { address } = req.query;

      // Validate required parameters
      if (!address) {
        return next(
          new AppError(
            'Address is required',
            400,
            'MISSING_PARAMETERS'
          )
        );
      }

      // Perform forward geocoding
      const result = await forwardGeocode(address as string);

      if (!result.success) {
        return next(
          new AppError(
            result.error || 'Geocoding failed',
            400,
            'GEOCODING_FAILED'
          )
        );
      }

      res.json(successResponse(result.data, 'Coordinates found successfully'));

    } catch (error) {
      next(error);
    }
  }
}

export default new GeocodingController();
