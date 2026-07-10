import { CronConfig } from '../types/cron';

/**
 * Cron service configuration.
 *
 * The legacy per-source scrape schedule (and the Fotocasa `localhost:3000`
 * sidecar source list) has been RETIRED: external listing ingestion now runs in
 * the dedicated worker via `@homiio/listing-providers` on BullMQ, not on a cron
 * in the API process. Only the housekeeping schedules (health + TTL cleanup)
 * remain here.
 */
export const cronConfig: CronConfig = {
  scrapeInterval: '', // retired — no scrape loop runs in the API process
  healthCheckInterval: '*/5 * * * *', // Every 5 minutes
  cleanupSchedule: '0 2 * * *', // Daily at 2 AM
  timezone: 'UTC'
};

/**
 * Get environment-specific cron configuration (health + cleanup schedules).
 */
export function getCronConfig(): CronConfig {
  const env = process.env.NODE_ENV || 'development';

  if (env === 'production') {
    return {
      ...cronConfig,
      healthCheckInterval: '*/10 * * * *', // Every 10 minutes in production
    };
  }

  return cronConfig;
}
