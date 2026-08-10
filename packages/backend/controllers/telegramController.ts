/**
 * Telegram Controller
 * Handles Telegram bot management and testing operations
 */

import type { Request, Response, NextFunction } from 'express';
import { PropertyStatus } from '@homiio/shared-types';

import { telegramService } from '../services';
import { AppError, successResponse } from '../middlewares/errorHandler';
import type { SQL } from 'drizzle-orm';

import config from '../config';
import { properties } from '../db/schema';
import {
  allOf,
  findProperties,
  findPropertyById,
  NEWEST_FIRST,
} from '../db/properties/propertyReads';
import {
  idIn,
  inCity,
  inDateRange,
  notDeleted,
  notModerationRestricted,
  statusIs,
  typeIn,
} from '../db/properties/propertyFilters';
import { serializeProperty } from '../db/properties/propertySerializer';
import { resolveAddressDisplay, type AddressGeoLike } from '../services/geoDisplayService';
import { resolveCityId } from '../services/geoQueryService';

/**
 * How many listings one bulk-notification request may fan out to.
 *
 * Carried over from the Mongo `.limit(50)`, whose comment read "prevent abuse" —
 * this endpoint sends real messages, so the bound is the point.
 */
const BULK_NOTIFICATION_LIMIT = 50;

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

      const hydrated = await findPropertyById(propertyId);
      if (!hydrated) {
        return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
      }
      // The serialized listing nests its address and carries the resolved geo
      // NAMES on it, which is what the notifier reads — the `.populate()` this
      // replaces existed only to produce that shape.
      const property = serializeProperty(hydrated);

      const geo = await resolveAddressDisplay(property.address as AddressGeoLike);
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

      let notifiable: Record<string, unknown>[] = [];

      if (propertyIds && propertyIds.length > 0) {
        // Send notifications for specific properties
        const ids = (propertyIds as unknown[]).map(String);
        notifiable = (await findProperties({ where: idIn(ids) })).map(serializeProperty);
      } else if (filters) {
        const conditions: (SQL | undefined)[] = [];

        // City filter via RELATIONAL geo: the city NAME (or id) resolves to a
        // canonical `cities.id` and the address join compares against it. The
        // `resolveGeoFilterAddressIds` call this replaces loaded every address
        // id in the city into an uncapped `$in`.
        if (filters.city) {
          const cityId = await resolveCityId(String(filters.city));
          if (!cityId) {
            return res.json(successResponse(
              { total: 0, successful: 0, failed: 0 },
              'No properties found in specified city'
            ));
          }
          conditions.push(inCity(cityId));
        }

        if (filters.type) conditions.push(typeIn([String(filters.type)]));
        if (filters.createdAfter) {
          conditions.push(inDateRange(properties.createdAt, new Date(String(filters.createdAfter)), undefined));
        }
        if (filters.status) conditions.push(statusIs(String(filters.status)));

        notifiable = (
          await findProperties({ where: allOf(conditions), limit: BULK_NOTIFICATION_LIMIT })
        ).map(serializeProperty);
      } else {
        return next(new AppError('Either propertyIds or filters must be provided', 400, 'MISSING_PARAMETERS'));
      }

      if (notifiable.length === 0) {
        return res.json(successResponse(
          { total: 0, successful: 0, failed: 0 },
          'No properties found matching criteria'
        ));
      }

      const results = await telegramService.sendBulkNotifications(notifiable);

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
      
      const groupConfig = telegramService.getDefaultGroup();
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

      // Get recent properties.
      //
      // This filtered `status = 'active'`, which is not a member of
      // `PropertyStatus` and so matched nothing — the third and last site of the
      // dead value #290 was opened about. It mattered more here than on a read:
      // the endpoint below sends REAL messages to public Telegram groups, and an
      // empty result meant it has always reported "no recent properties" and
      // sent none.
      //
      // `published` rather than the broader set `by-ids` uses, because this
      // BROADCASTS: a reserved, rented or deactivated listing is not something
      // to announce to a city group, and a soft-deleted or jury-restricted one
      // certainly is not.
      const sinceDate = new Date(Date.now() - hoursNum * 60 * 60 * 1000);
      const recentProperties = (
        await findProperties({
          where: allOf([
            inDateRange(properties.createdAt, sinceDate, undefined),
            notDeleted(),
            notModerationRestricted(),
            statusIs(PropertyStatus.PUBLISHED),
          ]),
          orderBy: [NEWEST_FIRST],
          limit: limitNum,
        })
      ).map(serializeProperty);

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

      const summaries = await Promise.all(recentProperties.map(async (listing) => ({
        id: listing.id,
        city: (await resolveAddressDisplay(listing.address as AddressGeoLike)).city,
        type: listing.type,
        createdAt: listing.createdAt,
      })));

      res.json(successResponse({
        ...results,
        timeframe: `${hoursNum} hours`,
        properties: summaries,
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

export default new TelegramController();