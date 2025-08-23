import { ScraperOptions } from '../services/scraperService';

export interface ScrapeSource extends ScraperOptions {
  pages?: number;
  enabled?: boolean;
}

export interface CronConfig {
  scrapeInterval: string;
  healthCheckInterval: string;
  cleanupSchedule: string;
  timezone: string;
}

export interface CronJobStatus {
  name: string;
  isRunning: boolean;
  lastRun?: Date;
  nextRun?: Date;
  errorCount: number;
}

export interface ScrapeMetrics {
  source: string;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: Date;
}

export interface HealthMetrics {
  status: 'healthy' | 'unhealthy';
  externalPropertyCount: number;
  oldestUpdate: Date;
  timestamp: Date;
}

export interface CleanupMetrics {
  deleted: number;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: Date;
}
