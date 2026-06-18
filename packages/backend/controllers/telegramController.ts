/**
 * Telegram Controller
 * Handles Telegram bot management and testing operations
 */

import type { Request, Response, NextFunction } from 'express';

import { telegramService } from '../services';
import { AppError, successResponse } from '../middlewares/errorHandler';
import { Property } from '../models';
import type { IProperty } from '../models/Property';
import config from '../config';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
function errorName(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

interface TelegramBotInfo {
  id: number;
  username: string;
  first_name: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

interface TelegramBotStatus {
  enabled: boolean;
  initialized: boolean;
  botToken: string;
  groupMappings: unknown;
  botInfo?: {
    id: number;
    username: string;
    firstName: string;
    canJoinGroups?: boolean;
    canReadAllGroupMessages?: boolean;
    supportsInlineQueries?: boolean;
  };
  botInfoError?: string;
}

class TelegramController {
  /**
   * Get Telegram bot status and configuration
   */
  async getBotStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {

      const status: TelegramBotStatus = {
        enabled: config.telegram.enabled,
        initialized: false, // We'll determine this by trying to get bot info
        botToken: config.telegram.botToken ? '***CONFIGURED***' : 'NOT_CONFIGURED',
        groupMappings: telegramService.getGroupsSummary()
      };

      // Try to get bot info to determine if initialized
      try {
        const botInfo = (await telegramService.getBotInfo()) as TelegramBotInfo;
        status.initialized = true;
        status.botInfo = {
          id: botInfo.id,
          username: botInfo.username,
          firstName: botInfo.first_name,
          canJoinGroups: botInfo.can_join_groups,
          canReadAllGroupMessages: botInfo.can_read_all_group_messages,
          supportsInlineQueries: botInfo.supports_inline_queries
        };
      } catch (error) {
        status.initialized = false;
        status.botInfoError = errorMessage(error);
      }

      res.json(successResponse(status, 'Telegram bot status retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Send a test message to a specific group
   */
  async sendTestMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { groupId, message, topicId } = req.body;

      if (!groupId) {
        return next(new AppError('Group ID is required', 400, 'MISSING_GROUP_ID'));
      }

      const success = await telegramService.sendTestMessage(groupId, message, true, topicId);

      if (success) {
        res.json(successResponse(
          { groupId, topicId, sent: true },
          'Test message sent successfully'
        ));
      } else {
        res.status(500).json(successResponse(
          { groupId, topicId, sent: false },
          'Failed to send test message'
        ));
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Send property notification to appropriate group (manual trigger)
   */
  async sendPropertyNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { propertyId } = req.params;

      // Populate the address so the notifier can resolve the relational geo.
      const property = await Property.findById(propertyId).populate('addressId');
      if (!property) {
        return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
      }

      const { resolveAddressDisplay } = require('../services/geoDisplayService');
      const geo = await resolveAddressDisplay(property.address);
      const success = await telegramService.sendPropertyNotification(property);

      res.status(success ? 200 : 500).json(successResponse(
        { propertyId, city: geo.city, sent: success },
        success ? 'Property notification sent successfully' : 'Failed to send property notification'
      ));
    } catch (error) {
      if (errorName(error) === 'CastError') {
        return next(new AppError('Invalid property ID', 400, 'INVALID_PROPERTY_ID'));
      }
      next(error);
    }
  }

  /**
   * Send bulk notifications for multiple properties
   */
  async sendBulkNotifications(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { propertyIds, filters } = req.body;

      let properties: IProperty[] = [];

      if (propertyIds && propertyIds.length > 0) {
        // Send notifications for specific properties
        properties = await Property.find({ _id: { $in: propertyIds } }).populate('addressId');
      } else if (filters) {
        // Send notifications based on filters
        const query: Record<string, unknown> = {};
        
        // Handle city filter via RELATIONAL geo resolution (name/id → cityId).
        if (filters.city) {
          const { resolveGeoFilterAddressIds } = require('../services/geoQueryService');
          const addressIds = await resolveGeoFilterAddressIds({ city: String(filters.city) });
          if (addressIds === null || addressIds.length === 0) {
            return res.json(successResponse(
              { total: 0, successful: 0, failed: 0 },
              'No properties found in specified city'
            ));
          }
          query.addressId = { $in: addressIds };
        }
        
        if (filters.type) query.type = filters.type;
        if (filters.createdAfter) query.createdAt = { $gte: new Date(filters.createdAfter) };
        if (filters.status) query.status = filters.status;

        properties = await Property.find(query).populate('addressId').limit(50); // Limit to prevent abuse
      } else {
        return next(new AppError('Either propertyIds or filters must be provided', 400, 'MISSING_PARAMETERS'));
      }

      if (properties.length === 0) {
        return res.json(successResponse(
          { total: 0, successful: 0, failed: 0 },
          'No properties found matching criteria'
        ));
      }

      const results = await telegramService.sendBulkNotifications(properties);

      res.json(successResponse(results, 'Bulk notifications processed'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get group mapping for a specific city
   */
  async getGroupMapping(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { city } = req.params;
      
      const groupConfig = telegramService.getGroupForCity(city);
      const groupsSummary = telegramService.getGroupsSummary();

      res.json(successResponse({
        city,
        groupId: groupConfig?.id,
        configured: !!groupConfig?.id,
        allMappings: groupsSummary
      }, 'Group mapping retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Test location support functionality
   */
  async testLocationSupport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const testResults = telegramService.testLocationSupport();
      
      res.json(successResponse(testResults, 'Location support test completed'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check if a specific location is supported
   */
  async checkLocationSupport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { city, country } = req.query;

      if (!city || !country) {
        return next(new AppError('Both city and country are required', 400, 'MISSING_PARAMETERS'));
      }

      const cityStr = String(city);
      const countryStr = String(country);
      const isSupported = telegramService.isLocationSupported(cityStr, countryStr);
      const topicId = telegramService.getTopicIdForLocation(cityStr, countryStr);

      res.json(successResponse({
        city: cityStr,
        country: countryStr,
        isSupported,
        topicId,
        locationKey: `${cityStr}, ${countryStr}`
      }, 'Location support check completed'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Test notifications for recent properties
   */
  async testRecentProperties(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { limit = 5, hours = 24 } = req.query;
      const limitNum = parseInt(String(limit), 10) || 5;
      const hoursNum = parseInt(String(hours), 10) || 24;

      // Get recent properties
      const sinceDate = new Date(Date.now() - hoursNum * 60 * 60 * 1000);
      const recentProperties = await Property.find({
        createdAt: { $gte: sinceDate },
        status: 'active'
      })
      .populate('addressId')
      .limit(limitNum)
      .sort({ createdAt: -1 });

      if (recentProperties.length === 0) {
        return res.json(successResponse(
          {
            found: 0,
            sent: 0,
            message: `No properties created in the last ${hoursNum} hours`
          },
          'No recent properties to test with'
        ));
      }

      const results = await telegramService.sendBulkNotifications(recentProperties);

      const { resolveAddressDisplay } = require('../services/geoDisplayService');
      const properties = await Promise.all(recentProperties.map(async (p: IProperty) => ({
        id: p._id,
        city: (await resolveAddressDisplay(p.address)).city,
        type: p.type,
        createdAt: p.createdAt
      })));

      res.json(successResponse({
        ...results,
        timeframe: `${hoursNum} hours`,
        properties
      }, 'Test notifications sent for recent properties'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Telegram webhook info (for debugging)
   * Note: This functionality has been removed due to private property access restrictions
   */
  async getWebhookInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      return next(new AppError('Webhook info functionality not available', 501, 'NOT_IMPLEMENTED'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TelegramController();