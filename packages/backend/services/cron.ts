import cron from 'node-cron';
import { Logger } from '../utils/logger';
import { ScraperService } from './scraperService';
import { HealthService } from './healthService';
import { CleanupService } from './cleanupService';
import { CronConfig, ScrapeSource } from '../types/cron';
import { MetricsService } from '../utils/metrics';
import { getCronConfig, getEnabledSources } from '../config/cron';

// Initialize services
const logger = new Logger('CronService');
const scraperService = new ScraperService();
const healthService = new HealthService();
const cleanupService = new CleanupService();
const metricsService = new MetricsService();

// Get configuration
const cronConfig = getCronConfig();
const SCRAPE_SOURCES = getEnabledSources();

/**
 * Handles scraping for a single source with proper error handling and metrics
 */
class SourceScraper {
  private source: ScrapeSource;
  private logger: Logger;

  constructor(source: ScrapeSource) {
    this.source = source;
    this.logger = new Logger(`CronService:${source.source}`);
  }

  async scrape(): Promise<void> {
    const startTime = Date.now();
    
    try {
      if (!this.source.enabled) {
        this.logger.info('Source disabled, skipping');
        return;
      }

      this.logger.info(`Starting scrape from ${this.source.endpoint}`);
      
      if (this.source.pages && this.source.pages > 1) {
        await this.scrapePaginated();
      } else {
        await this.scrapeSingle();
      }
      
      const duration = Date.now() - startTime;
      metricsService.recordScrapeSuccess(this.source.source, duration);
      this.logger.info(`Scrape completed in ${duration}ms`);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      metricsService.recordScrapeError(this.source.source, error, duration);
      this.logger.error('Scrape failed', error);
      throw error;
    }
  }

  private async scrapePaginated(): Promise<void> {
    const allResults = [];
    
    for (let page = 1; page <= this.source.pages!; page++) {
      const url = `${this.source.endpoint}?page=${page}`;
      this.logger.info(`Scraping page ${page}/${this.source.pages}`);
      
      const result = await scraperService.runExternalScrape({
        ...this.source,
        endpoint: url
      });
      
      allResults.push(result);
      
      // Add delay between pages to be respectful
      if (page < this.source.pages!) {
        await this.delay(1000);
      }
    }
    
    // Aggregate results
    const totalResult = this.aggregateResults(allResults);
    this.logger.info('Completed all pages', {
      pages: this.source.pages,
      created: totalResult.created,
      updated: totalResult.updated,
      errors: totalResult.errors,
      duration: `${totalResult.duration}ms`
    });
  }

  private async scrapeSingle(): Promise<void> {
    const result = await scraperService.runExternalScrape(this.source);
    this.logger.info('Completed single page scrape', {
      created: result.created,
      updated: result.updated,
      errors: result.errors,
      duration: `${result.duration}ms`
    });
  }

  private aggregateResults(results: any[]): any {
    return results.reduce((acc, curr) => ({
      created: acc.created + curr.created,
      updated: acc.updated + curr.updated,
      skipped: acc.skipped + curr.skipped,
      errors: acc.errors + curr.errors,
      totalProcessed: acc.totalProcessed + curr.totalProcessed,
      duration: acc.duration + curr.duration,
      errorDetails: [...acc.errorDetails, ...curr.errorDetails]
    }), {
      created: 0, updated: 0, skipped: 0, errors: 0,
      totalProcessed: 0, duration: 0, errorDetails: []
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Main cron job manager
 */
class CronJobManager {
  private logger: Logger;
  private jobs: Map<string, cron.ScheduledTask> = new Map();

  constructor() {
    this.logger = new Logger('CronJobManager');
  }

  /**
   * Initialize all cron jobs
   */
  init(): void {
    this.setupScrapeJob();
    this.setupHealthCheckJob();
    this.setupCleanupJob();
    
    this.logger.info('All cron jobs initialized');
    this.logEnabledSources();
  }

  /**
   * Setup the main scraping job - runs every 30 seconds
   */
  private setupScrapeJob(): void {
    const job = cron.schedule('*/30 * * * * *', async () => {
      await this.runScrapeCycle();
    }, { 
      timezone: 'UTC',
      scheduled: false // Don't start immediately
    });

    this.jobs.set('scrape', job);
    job.start();
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
    job.start();
  }

  /**
   * Run the main scraping cycle
   */
  private async runScrapeCycle(): Promise<void> {
    const startTime = Date.now();
    const cycleId = `cycle_${Date.now()}`;
    
    try {
      this.logger.info(`Starting scrape cycle ${cycleId}`);
      
      const enabledSources = SCRAPE_SOURCES.filter(source => source.enabled);
      
      if (enabledSources.length === 0) {
        this.logger.info('No enabled sources found');
        return;
      }
      
      // Run sources in parallel with proper error handling
      const scrapePromises = enabledSources.map(source => 
        new SourceScraper(source).scrape().catch(error => {
          this.logger.error(`Failed to scrape ${source.source}`, error);
          return null; // Don't fail the entire cycle
        })
      );
      
      await Promise.all(scrapePromises);
      
      const duration = Date.now() - startTime;
      metricsService.recordCycleSuccess(cycleId, duration, enabledSources.length);
      this.logger.info(`Scrape cycle ${cycleId} completed in ${duration}ms`);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      metricsService.recordCycleError(cycleId, error, duration);
      this.logger.error(`Scrape cycle ${cycleId} failed`, error);
    }
  }

  /**
   * Run health check
   */
  private async runHealthCheck(): Promise<void> {
    try {
      const health = await healthService.getScraperHealth();
      
      this.logger.info('Health check completed', {
        status: health.status,
        externalProperties: health.details.externalPropertyCount,
        oldestUpdate: health.details.oldestExternalProperty
      });
      
      if (health.status === 'unhealthy') {
        this.logger.warn('Scraper health is unhealthy!');
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
  }

  /**
   * Get status of all jobs
   */
  getStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    this.jobs.forEach((job, name) => {
      status[name] = job.getStatus() === 'scheduled';
    });
    return status;
  }

  private logEnabledSources(): void {
    const enabledSources = SCRAPE_SOURCES.filter(s => s.enabled);
    this.logger.info(`Configured sources: ${enabledSources.map(s => s.source).join(', ')}`);
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
    logger.info('Enhanced cron jobs initialized with health monitoring and cleanup');
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
