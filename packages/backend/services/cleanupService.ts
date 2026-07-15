import { Logger } from '../utils/logger';
import { cleanupExpiredProperties } from './scraperService';

const RECENTLY_VIEWED_RETENTION_DAYS = 90;
const VIEWING_REQUEST_RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cleanup service for managing expired properties and data
 */
export class CleanupService {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('CleanupService');
  }

  /**
   * Clean up expired external properties
   */
  async cleanupExpiredProperties(dryRun: boolean = true): Promise<{
    deleted: number;
    errors: number;
  }> {
    try {
      this.logger.info(`Starting expired property cleanup (dryRun: ${dryRun})`);
      
      const result = await cleanupExpiredProperties(dryRun);
      
      if (dryRun) {
        this.logger.info(`Would delete ${result.deleted} expired properties`);
      } else {
        this.logger.info(`Deleted ${result.deleted} expired properties`);
      }
      
      return result;
    } catch (error) {
      this.logger.error('Cleanup failed', error);
      return { deleted: 0, errors: 1 };
    }
  }

  /**
   * Clean up stale user-activity data using conservative retention windows:
   * - RecentlyViewed entries older than 90 days (by viewedAt)
   * - Resolved ViewingRequests (declined or cancelled) older than 180 days
   *   (by updatedAt — the time the request reached its terminal state)
   *
   * Returns the real total of removed documents. Failures in one collection do
   * not prevent the other from being cleaned.
   */
  async cleanupOldData(): Promise<{
    deleted: number;
    errors: number;
  }> {
    this.logger.info('Starting old data cleanup');

    const { RecentlyViewed, ViewingRequest } = require('../models') as typeof import('../models');
    const now = Date.now();
    const recentlyViewedCutoff = new Date(now - RECENTLY_VIEWED_RETENTION_DAYS * DAY_MS);
    const viewingRequestCutoff = new Date(now - VIEWING_REQUEST_RETENTION_DAYS * DAY_MS);

    let deleted = 0;
    let errors = 0;

    try {
      const result = await RecentlyViewed.deleteMany({ viewedAt: { $lt: recentlyViewedCutoff } });
      deleted += result.deletedCount || 0;
      this.logger.info(`Deleted ${result.deletedCount || 0} recently-viewed entries older than ${RECENTLY_VIEWED_RETENTION_DAYS} days`);
    } catch (error) {
      errors += 1;
      this.logger.error('RecentlyViewed cleanup failed', error);
    }

    try {
      const result = await ViewingRequest.deleteMany({
        status: { $in: ['declined', 'cancelled'] },
        updatedAt: { $lt: viewingRequestCutoff },
      });
      deleted += result.deletedCount || 0;
      this.logger.info(`Deleted ${result.deletedCount || 0} declined/cancelled viewing requests older than ${VIEWING_REQUEST_RETENTION_DAYS} days`);
    } catch (error) {
      errors += 1;
      this.logger.error('ViewingRequest cleanup failed', error);
    }

    this.logger.info(`Old data cleanup completed: ${deleted} documents removed, ${errors} errors`);
    return { deleted, errors };
  }

  /**
   * Perform full system cleanup
   */
  async performFullCleanup(): Promise<{
    properties: { deleted: number; errors: number };
    data: { deleted: number; errors: number };
  }> {
    try {
      this.logger.info('Starting full system cleanup');
      
      const [properties, data] = await Promise.all([
        this.cleanupExpiredProperties(false),
        this.cleanupOldData()
      ]);
      
      this.logger.info('Full cleanup completed', {
        propertiesDeleted: properties.deleted,
        dataDeleted: data.deleted
      });
      
      return { properties, data };
    } catch (error) {
      this.logger.error('Full cleanup failed', error);
      return {
        properties: { deleted: 0, errors: 1 },
        data: { deleted: 0, errors: 1 }
      };
    }
  }
}
