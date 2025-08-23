import { CronConfig, ScrapeSource } from '../types/cron';

/**
 * Cron service configuration
 */
export const cronConfig: CronConfig = {
  scrapeInterval: '*/30 * * * * *', // Every 30 seconds
  healthCheckInterval: '*/5 * * * *', // Every 5 minutes
  cleanupSchedule: '0 2 * * *', // Daily at 2 AM
  timezone: 'UTC'
};

/**
 * Scrape sources configuration
 */
export const scrapeSources: ScrapeSource[] = [
  {
    source: 'fotocasa',
    endpoint: process.env.FOTOCASA_ENDPOINT || 'http://localhost:3000/search/all/barcelona',
    pages: parseInt(process.env.FOTOCASA_PAGES || '1', 10),
    enabled: process.env.FOTOCASA_ENABLED !== 'false',
    timeout: parseInt(process.env.FOTOCASA_TIMEOUT || '30000', 10),
    maxRetries: parseInt(process.env.FOTOCASA_MAX_RETRIES || '3', 10),
    batchSize: parseInt(process.env.FOTOCASA_BATCH_SIZE || '25', 10),
    ttlDays: parseInt(process.env.FOTOCASA_TTL_DAYS || '30', 10)
  },
  // Add more sources here as needed
  // {
  //   source: 'idealista',
  //   endpoint: process.env.IDEALISTA_ENDPOINT || 'http://localhost:3000/search/all/madrid',
  //   pages: parseInt(process.env.IDEALISTA_PAGES || '1', 10),
  //   enabled: process.env.IDEALISTA_ENABLED === 'true',
  //   timeout: parseInt(process.env.IDEALISTA_TIMEOUT || '30000', 10),
  //   maxRetries: parseInt(process.env.IDEALISTA_MAX_RETRIES || '3', 10),
  //   batchSize: parseInt(process.env.IDEALISTA_BATCH_SIZE || '25', 10),
  //   ttlDays: parseInt(process.env.IDEALISTA_TTL_DAYS || '30', 10)
  // }
];

/**
 * Get environment-specific configuration
 */
export function getCronConfig(): CronConfig {
  const env = process.env.NODE_ENV || 'development';
  
  if (env === 'production') {
    return {
      ...cronConfig,
      scrapeInterval: '*/60 * * * * *', // Every minute in production
      healthCheckInterval: '*/10 * * * *', // Every 10 minutes in production
    };
  }
  
  return cronConfig;
}

/**
 * Get enabled scrape sources
 */
export function getEnabledSources(): ScrapeSource[] {
  return scrapeSources.filter(source => source.enabled);
}
