import cron from 'node-cron';
import { Logger } from '../utils/logger';
import { HealthService } from './healthService';
import { CleanupService } from './cleanupService';
import { MetricsService } from '../utils/metrics';
import { syncCovers } from './cityCoverSyncService';

// Initialize services
const logger = new Logger('CronService');
const healthService = new HealthService();
const cleanupService = new CleanupService();
const metricsService = new MetricsService();

/**
 * Cron job manager.
 *
 * The legacy 30-second Fotocasa scrape loop (which depended on a `localhost`
 * sidecar) has been RETIRED — external listing ingestion now runs in the
 * dedicated worker (`worker.ts` + `@homiio/listing-providers` on BullMQ), never
 * in the API process on a cron. This manager keeps only the lightweight
 * housekeeping jobs: external-listing health monitoring and TTL cleanup.
 */
class CronJobManager {
  private logger: Logger;
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private jobStatus: Map<string, { isRunning: boolean; lastRun?: Date; nextRun?: Date }> = new Map();

  constructor() {
    this.logger = new Logger('CronJobManager');
  }

  /**
   * Initialize all cron jobs (health monitoring + TTL cleanup only).
   */
  init(): void {
    this.setupHealthCheckJob();
    this.setupCleanupJob();
    this.setupCityCoverSyncJob();

    this.logger.info('Cron jobs initialized (health + cleanup + city covers; scrape loop retired)');
  }

  /**
   * Setup health check job - runs every 5 minutes
   */
  private setupHealthCheckJob(): void {
    const job = cron.schedule('*/5 * * * *', async () => {
      await this.runHealthCheck();
    }, { 
      timezone: 'UTC',
      scheduled: false
    });

    this.jobs.set('health', job);
    this.jobStatus.set('health', { isRunning: true, lastRun: undefined, nextRun: undefined });
    job.start();
  }

  /**
   * Setup cleanup job - runs daily at 2 AM
   */
  private setupCleanupJob(): void {
    const job = cron.schedule('0 2 * * *', async () => {
      await this.runCleanup();
    }, { 
      timezone: 'UTC',
      scheduled: false
    });

    this.jobs.set('cleanup', job);
    this.jobStatus.set('cleanup', { isRunning: true, lastRun: undefined, nextRun: undefined });
    job.start();
  }

  /**
   * Setup city cover sync job - runs every hour
   */
  private setupCityCoverSyncJob(): void {
    const job = cron.schedule('0 * * * *', async () => {
      await this.runCityCoverSync();
    }, {
      timezone: 'UTC',
      scheduled: false,
    });

    this.jobs.set('cityCovers', job);
    this.jobStatus.set('cityCovers', { isRunning: true, lastRun: undefined, nextRun: undefined });
    job.start();
  }

  /**
   * Backfill city cover images from Wikimedia Commons and replace listing-linked covers.
   */
  private async runCityCoverSync(): Promise<void> {
    const status = this.jobStatus.get('cityCovers');
    if (status) {
      status.lastRun = new Date();
      status.isRunning = true;
    }

    try {
      const processed = await syncCovers({ limit: 50, forceReplaceListingCovers: true });
      this.logger.info('City cover sync completed', { processed });
    } catch (error) {
      this.logger.error('City cover sync failed', error);
    }
  }

  /**
   * Run health check
   */
  private async runHealthCheck(): Promise<void> {
    // Update job status
    const status = this.jobStatus.get('health');
    if (status) {
      status.lastRun = new Date();
      status.isRunning = true;
    }
    
    try {
      const health = await healthService.getScraperHealth();
      
      this.logger.info('Health check completed', {
        status: health.status,
        externalProperties: health.details.externalPropertyCount,
        oldestUpdate: health.details.oldestExternalProperty
      });
      
      if (health.status === 'unhealthy') {
        this.logger.warn('External-listing health is unhealthy!');
        metricsService.recordHealthCheckFailure();
      } else {
        metricsService.recordHealthCheckSuccess();
      }
      
    } catch (error) {
      this.logger.error('Health check failed', error);
      metricsService.recordHealthCheckFailure();
    }
  }

  /**
   * Run cleanup of expired properties
   */
  private async runCleanup(): Promise<void> {
    // Update job status
    const status = this.jobStatus.get('cleanup');
    if (status) {
      status.lastRun = new Date();
      status.isRunning = true;
    }
    
    try {
      this.logger.info('Starting expired property cleanup');
      
      // First run a dry run to see what would be deleted
      const dryRun = await cleanupService.cleanupExpiredProperties(true);
      this.logger.info(`Would delete ${dryRun.deleted} expired properties`);
      
      if (dryRun.deleted > 0) {
        // Actually delete them
        const result = await cleanupService.cleanupExpiredProperties(false);
        this.logger.info(`Deleted ${result.deleted} expired properties`);
        metricsService.recordCleanupSuccess(result.deleted);
      }

      // Remove stale user-activity data (recently-viewed history, resolved viewing requests)
      const dataResult = await cleanupService.cleanupOldData();
      this.logger.info(`Removed ${dataResult.deleted} stale data records`);
      if (dataResult.deleted > 0) {
        metricsService.recordCleanupSuccess(dataResult.deleted);
      }

    } catch (error) {
      this.logger.error('Cleanup failed', error);
      metricsService.recordCleanupFailure();
    }
  }

  /**
   * Stop all cron jobs
   */
  stop(): void {
    this.jobs.forEach((job, name) => {
      job.stop();
      this.logger.info(`Stopped cron job: ${name}`);
    });
    this.jobs.clear();
    this.jobStatus.clear();
  }

  /**
   * Get status of all jobs
   */
  getStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    this.jobStatus.forEach((jobStatus, name) => {
      status[name] = jobStatus.isRunning;
    });
    return status;
  }
}

// Initialize the cron job manager
const cronManager = new CronJobManager();

/**
 * Initialize cron jobs
 */
export function initCronJobs(): void {
  try {
    cronManager.init();
    logger.info('Cron jobs initialized with health monitoring and cleanup');
  } catch (error) {
    logger.error('Failed to initialize cron jobs', error);
    throw error;
  }
}

/**
 * Stop cron jobs (useful for graceful shutdown)
 */
export function stopCronJobs(): void {
  cronManager.stop();
  logger.info('Cron jobs stopped');
}

/**
 * Get cron job status
 */
export function getCronStatus(): Record<string, boolean> {
  return cronManager.getStatus();
}
