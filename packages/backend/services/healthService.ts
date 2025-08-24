import { Logger } from '../utils/logger';
import { getScraperHealth } from './scraperService';

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
      const scraperHealth = await this.getScraperHealth();
      
      // In a real implementation, you'd check database connectivity here
      const databaseHealth = 'healthy' as 'healthy' | 'degraded' | 'unhealthy';
      
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
