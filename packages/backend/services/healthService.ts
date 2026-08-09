import { Logger } from '../utils/logger';
import { checkPostgresHealth, isPostgresConnected } from '../db/postgres';
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
   * Get database health status — PostgreSQL, the only store this service opens.
   *
   * Reports `unhealthy` when no pool has been published (nothing ever
   * connected), `degraded` when a pool exists but a trivial query does not come
   * back, and `healthy` when it does. Same three states the Mongo probe
   * reported, so `/health`'s body keeps its meaning across the migration.
   *
   * The query is BOUNDED. `checkPostgresHealth` never throws, but postgres.js
   * queues a query when every connection in the pool is busy, so an unbounded
   * probe turns a saturated task into one that stops answering `/health` — and
   * the ALB reads silence as death and drains it, which is precisely the wrong
   * response to load. A timeout reports `degraded` and keeps the endpoint fast.
   */
  async getDatabaseHealth(): Promise<'healthy' | 'degraded' | 'unhealthy'> {
    if (!isPostgresConnected()) {
      this.logger.warn('Database pool not published');
      return 'unhealthy';
    }

    let timer: NodeJS.Timeout | undefined;
    try {
      const answered = await Promise.race([
        checkPostgresHealth(),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), DB_PING_TIMEOUT_MS);
        }),
      ]);
      return answered ? 'healthy' : 'degraded';
    } finally {
      if (timer) clearTimeout(timer);
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
