/**
 * Telegram Controller
 * Handles Telegram bot management and testing operations
 */

import { telegramService } from '../services';
import { logger } from '../middlewares/logging';
import { AppError, successResponse } from '../middlewares/errorHandler';
const { Property } = require('../models');
import config from '../config';

class TelegramController {
  /**
   * Get Telegram bot status and configuration
   */
  async getBotStatus(req, res, next) {
    try {
      
      const status: any = {
        enabled: config.telegram.enabled,
        initialized: false, // We'll determine this by trying to get bot info
        botToken: config.telegram.botToken ? '***CONFIGURED***' : 'NOT_CONFIGURED',
        groupMappings: telegramService.getGroupsSummary()
      };

      // Try to get bot info to determine if initialized
      try {
        const botInfo = await telegramService.getBotInfo();
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
        status.botInfoError = error.message;
      }

      res.json(successResponse(status, 'Telegram bot status retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Send a test message to a specific group
   */
  async sendTestMessage(req, res, next) {
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
  async sendPropertyNotification(req, res, next) {
    try {
      const { propertyId } = req.params;

      // Get the property from database
      const property = await Property.findById(propertyId);
      if (!property) {
        return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
      }

      const success = await telegramService.sendPropertyNotification(property);

      if (success) {
        res.json(successResponse(
          { 
            propertyId,
            city: property.address?.city,
            sent: true 
          },
          'Property notification sent successfully'
        ));
      } else {
        res.status(500).json(successResponse(
          { 
            propertyId,
            city: property.address?.city,
            sent: false 
          },
          'Failed to send property notification'
        ));
      }
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid property ID', 400, 'INVALID_PROPERTY_ID'));
      }
      next(error);
    }
  }

  /**
   * Send bulk notifications for multiple properties
   */
  async sendBulkNotifications(req, res, next) {
    try {
      const { propertyIds, filters } = req.body;

      let properties = [];

      if (propertyIds && propertyIds.length > 0) {
        // Send notifications for specific properties
        properties = await Property.find({ _id: { $in: propertyIds } }).populate('addressId');
      } else if (filters) {
        // Send notifications based on filters
        const query: any = {};
        
        // Handle city filter with Address lookup
        if (filters.city) {
          const { Address } = require('../models');
          const addressQuery = { city: new RegExp(filters.city, 'i') };
          const matchingAddresses = await Address.find(addressQuery).select('_id');
          const addressIds = matchingAddresses.map(addr => addr._id);
          
          if (addressIds.length === 0) {
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
  async getGroupMapping(req, res, next) {
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
  async testLocationSupport(req, res, next) {
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
  async checkLocationSupport(req, res, next) {
    try {
      const { city, country } = req.query;
      
      if (!city || !country) {
        return next(new AppError('Both city and country are required', 400, 'MISSING_PARAMETERS'));
      }

      const isSupported = telegramService.isLocationSupported(city, country);
      const topicId = telegramService.getTopicIdForLocation(city, country);

      res.json(successResponse({
        city,
        country,
        isSupported,
        topicId,
        locationKey: `${city}, ${country}`
      }, 'Location support check completed'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Test notifications for recent properties
   */
  async testRecentProperties(req, res, next) {
    try {
      const { limit = 5, hours = 24 } = req.query;
      
      // Get recent properties
      const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000);
      const recentProperties = await Property.find({
        createdAt: { $gte: sinceDate },
        status: 'active'
      })
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

      if (recentProperties.length === 0) {
        return res.json(successResponse(
          { 
            found: 0,
            sent: 0,
            message: `No properties created in the last ${hours} hours`
          },
          'No recent properties to test with'
        ));
      }

      const results = await telegramService.sendBulkNotifications(recentProperties);

      res.json(successResponse({
        ...results,
        timeframe: `${hours} hours`,
        properties: recentProperties.map(p => ({
          id: p._id,
          city: p.address?.city,
          type: p.type,
          createdAt: p.createdAt
        }))
      }, 'Test notifications sent for recent properties'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Telegram webhook info (for debugging)
   * Note: This functionality has been removed due to private property access restrictions
   */
  async getWebhookInfo(req, res, next) {
    try {
      return next(new AppError('Webhook info functionality not available', 501, 'NOT_IMPLEMENTED'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TelegramController();