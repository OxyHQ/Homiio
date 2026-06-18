import mongoose from 'mongoose';
import { Logger } from '../utils/logger';
import { getScraperHealth } from './scraperService';

const DB_PING_TIMEOUT_MS = 2000;

/**
 * Health service for monitoring scraper and system health
 */
export class HealthService {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('HealthService');
  }

  /**
   * Get scraper health status
   */
  async getScraperHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: {
      externalPropertyCount: number;
      lastScrapeErrors: number;
      oldestExternalProperty: Date | null;
    };
  }> {
    try {
      const health = await getScraperHealth();
      this.logger.debug('Health check completed', health);
      return health;
    } catch (error) {
      this.logger.error('Health check failed', error);
      return {
        status: 'unhealthy',
        details: {
          externalPropertyCount: 0,
          lastScrapeErrors: 1,
          oldestExternalProperty: null,
        }
      };
    }
  }

  /**
   * Get database health status.
   *
   * Reports `unhealthy` when the mongoose connection is not in the connected
   * state (readyState !== 1), `degraded` when the connection reports connected
   * but the admin ping fails or times out, and `healthy` when the ping succeeds.
   */
  async getDatabaseHealth(): Promise<'healthy' | 'degraded' | 'unhealthy'> {
    const { readyState } = mongoose.connection;
    if (readyState !== 1) {
      this.logger.warn('Database connection not ready', { readyState });
      return 'unhealthy';
    }

    const db = mongoose.connection.db;
    if (!db) {
      this.logger.warn('Database handle unavailable despite connected state');
      return 'degraded';
    }

    try {
      await Promise.race([
        db.admin().ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database ping timed out')), DB_PING_TIMEOUT_MS),
        ),
      ]);
      return 'healthy';
    } catch (error) {
      this.logger.error('Database ping failed', error);
      return 'degraded';
    }
  }

  /**
   * Get system health overview
   */
  async getSystemHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: {
      scraper: 'healthy' | 'degraded' | 'unhealthy';
      database: 'healthy' | 'degraded' | 'unhealthy';
    };
    timestamp: Date;
  }> {
    try {
      const [scraperHealth, databaseHealth] = await Promise.all([
        this.getScraperHealth(),
        this.getDatabaseHealth(),
      ]);

      const overallStatus = scraperHealth.status === 'healthy' && databaseHealth === 'healthy' 
        ? 'healthy' 
        : (scraperHealth.status === 'unhealthy' || databaseHealth === 'unhealthy')
        ? 'unhealthy'
        : 'degraded';

      return {
        status: overallStatus,
        services: {
          scraper: scraperHealth.status,
          database: databaseHealth
        },
        timestamp: new Date()
      };
    } catch (error) {
      this.logger.error('System health check failed', error);
      return {
        status: 'unhealthy',
        services: {
          scraper: 'unhealthy',
          database: 'unhealthy'
        },
        timestamp: new Date()
      };
    }
  }
}
