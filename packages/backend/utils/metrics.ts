import { Logger } from './logger';
import { ScrapeMetrics, HealthMetrics, CleanupMetrics } from '../types/cron';

/**
 * Metrics service for tracking cron job performance and health
 */
export class MetricsService {
  private logger: Logger;
  private metrics: {
    scrapes: ScrapeMetrics[];
    health: HealthMetrics[];
    cleanups: CleanupMetrics[];
    cycles: Array<{
      id: string;
      duration: number;
      success: boolean;
      sourceCount: number;
      timestamp: Date;
    }>;
  };

  constructor() {
    this.logger = new Logger('MetricsService');
    this.metrics = {
      scrapes: [],
      health: [],
      cleanups: [],
      cycles: []
    };
  }

  /**
   * Record a successful scrape operation
   */
  recordScrapeSuccess(source: string, duration: number): void {
    const metric: ScrapeMetrics = {
      source,
      duration,
      success: true,
      timestamp: new Date()
    };
    
    this.metrics.scrapes.push(metric);
    this.logger.debug(`Recorded scrape success for ${source}`, { duration });
  }

  /**
   * Record a failed scrape operation
   */
  recordScrapeError(source: string, error: any, duration: number): void {
    const metric: ScrapeMetrics = {
      source,
      duration,
      success: false,
      error: error.message || 'Unknown error',
      timestamp: new Date()
    };
    
    this.metrics.scrapes.push(metric);
    this.logger.debug(`Recorded scrape error for ${source}`, { duration, error: error.message });
  }

  /**
   * Record a successful scrape cycle
   */
  recordCycleSuccess(cycleId: string, duration: number, sourceCount: number): void {
    this.metrics.cycles.push({
      id: cycleId,
      duration,
      success: true,
      sourceCount,
      timestamp: new Date()
    });
    
    this.logger.debug(`Recorded cycle success`, { cycleId, duration, sourceCount });
  }

  /**
   * Record a failed scrape cycle
   */
  recordCycleError(cycleId: string, error: any, duration: number): void {
    this.metrics.cycles.push({
      id: cycleId,
      duration,
      success: false,
      sourceCount: 0,
      timestamp: new Date()
    });
    
    this.logger.debug(`Recorded cycle error`, { cycleId, duration, error: error.message });
  }

  /**
   * Record a successful health check
   */
  recordHealthCheckSuccess(): void {
    // This would typically record to a metrics system like Prometheus
    this.logger.debug('Recorded health check success');
  }

  /**
   * Record a failed health check
   */
  recordHealthCheckFailure(): void {
    // This would typically record to a metrics system like Prometheus
    this.logger.debug('Recorded health check failure');
  }

  /**
   * Record a successful cleanup operation
   */
  recordCleanupSuccess(deletedCount: number): void {
    const metric: CleanupMetrics = {
      deleted: deletedCount,
      duration: 0, // Would be calculated in the actual cleanup
      success: true,
      timestamp: new Date()
    };
    
    this.metrics.cleanups.push(metric);
    this.logger.debug(`Recorded cleanup success`, { deletedCount });
  }

  /**
   * Record a failed cleanup operation
   */
  recordCleanupFailure(): void {
    const metric: CleanupMetrics = {
      deleted: 0,
      duration: 0,
      success: false,
      timestamp: new Date()
    };
    
    this.metrics.cleanups.push(metric);
    this.logger.debug('Recorded cleanup failure');
  }

  /**
   * Get metrics summary
   */
  getMetricsSummary(): any {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentScrapes = this.metrics.scrapes.filter(m => m.timestamp > oneHourAgo);
    const recentCycles = this.metrics.cycles.filter(m => m.timestamp > oneHourAgo);
    const recentCleanups = this.metrics.cleanups.filter(m => m.timestamp > oneDayAgo);

    return {
      scrapes: {
        total: this.metrics.scrapes.length,
        recent: recentScrapes.length,
        successRate: recentScrapes.length > 0 
          ? (recentScrapes.filter(s => s.success).length / recentScrapes.length * 100).toFixed(2) + '%'
          : '0%',
        averageDuration: recentScrapes.length > 0
          ? Math.round(recentScrapes.reduce((sum, s) => sum + s.duration, 0) / recentScrapes.length)
          : 0
      },
      cycles: {
        total: this.metrics.cycles.length,
        recent: recentCycles.length,
        successRate: recentCycles.length > 0
          ? (recentCycles.filter(c => c.success).length / recentCycles.length * 100).toFixed(2) + '%'
          : '0%',
        averageDuration: recentCycles.length > 0
          ? Math.round(recentCycles.reduce((sum, c) => sum + c.duration, 0) / recentCycles.length)
          : 0
      },
      cleanups: {
        total: this.metrics.cleanups.length,
        recent: recentCleanups.length,
        totalDeleted: this.metrics.cleanups.reduce((sum, c) => sum + c.deleted, 0)
      }
    };
  }

  /**
   * Clear old metrics (keep last 7 days)
   */
  clearOldMetrics(): void {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    this.metrics.scrapes = this.metrics.scrapes.filter(m => m.timestamp > sevenDaysAgo);
    this.metrics.cycles = this.metrics.cycles.filter(m => m.timestamp > sevenDaysAgo);
    this.metrics.cleanups = this.metrics.cleanups.filter(m => m.timestamp > sevenDaysAgo);
    this.metrics.health = this.metrics.health.filter(m => m.timestamp > sevenDaysAgo);
    
    this.logger.info('Cleared old metrics');
  }
}
