import cron from 'node-cron';
import { Logger } from '../utils/logger';
import { HealthService } from './healthService';
import { CleanupService } from './cleanupService';
import { MetricsService } from '../utils/metrics';
import { syncCovers } from './cityCoverSyncService';
import { repairCorruptCityCoordinates } from './cityCoordinateRepairService';
import { sendEvictionOutcomeReminders } from './evictionOutcomeReminderService';
import { reconcileModerationReports } from './moderation/ModerationReconciliation';
import { expireShareLinks } from '../db/conversations/conversationRepository';
import { getDb } from '../db/postgres';
import config from '../config';
import { syncAllHasImages } from '../db/hasImages';
import { EXPIRY_SWEEP_TARGETS, sweepAllExpiredRows } from '../db/expiry';
import { deliverDueDigests, runHousingAlertSweep } from './watches/housingAlertSweep';

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
    this.setupShareLinkExpiryJob();
    this.setupEvictionOutcomeReminderJob();
    this.setupModerationReconciliationJob();
    this.setupExpirySweepJob();
    this.setupHousingAlertJobs();
    // Boot sweeps: repair mangled coords + start Wikimedia cover backfill
    // without waiting for the top of the hour.
    void this.runBootHousekeeping();

    this.logger.info(
      'Cron jobs initialized (health + cleanup + city covers + eviction reminders + ' +
        'moderation reconciliation; scrape loop retired)',
    );
  }

  private async runBootHousekeeping(): Promise<void> {
    try {
      await this.backfillPropertyHasImages();
    } catch (error) {
      this.logger.error('Boot hasImages backfill failed', error);
    }
    try {
      const repaired = await repairCorruptCityCoordinates(200);
      this.logger.info('Boot city coordinate repair completed', { repaired });
    } catch (error) {
      this.logger.error('Boot city coordinate repair failed', error);
    }
    try {
      const processed = await syncCovers({ limit: 100, forceReplaceListingCovers: true });
      this.logger.info('Boot city cover sync completed', { processed });
    } catch (error) {
      this.logger.error('Boot city cover sync failed', error);
    }
  }

  /**
   * Idempotent reconciliation of the denormalized `has_images` flag.
   *
   * `db/hasImages.ts` is the ONE writer of that column and `syncAllHasImages`
   * re-derives it from `property_images` for the whole table in a single
   * statement, updating only the rows that actually disagree — so a boot where
   * nothing has drifted writes nothing.
   *
   * The Mongo version this replaces filtered on `hasImages: { $exists: false }`,
   * i.e. it only ever touched documents predating the field and could not
   * notice a row whose stored flag had gone WRONG. Production already holds one
   * of those, which is why the port reconciles rather than backfills.
   */
  private async backfillPropertyHasImages(): Promise<void> {
    const modified = await syncAllHasImages(getDb());
    if (modified > 0) {
      this.logger.info('Reconciled hasImages on properties', { modified });
    }
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
   * Setup the share-link expiry sweep — hourly.
   *
   * **This is the port of Mongo's TTL index on `Conversation.sharing.expiresAt`,
   * and it CLEARS four columns where Mongo deleted the whole row.** That index
   * destroyed the conversation and every message in it 24 hours after anybody
   * pressed Share, so replicating it would be replicating data loss;
   * `db/expiry.ts` names the column in `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE` and
   * `__tests__/db/expiry.test.ts` fails the build if it is ever registered as a
   * sweep target, which is why this job is here and not in `EXPIRY_SWEEP_TARGETS`.
   *
   * Nothing depends on it having run: `findConversationByShareToken` refuses an
   * expired token in its own predicate. The sweep exists so a token that is no
   * longer usable stops being STORED, and so the partial unique index stays the
   * size of the live set.
   */
  private setupShareLinkExpiryJob(): void {
    const job = cron.schedule('7 * * * *', async () => {
      await this.runShareLinkExpiry();
    }, {
      timezone: 'UTC',
      scheduled: false,
    });

    this.jobs.set('shareLinks', job);
    this.jobStatus.set('shareLinks', { isRunning: true, lastRun: undefined, nextRun: undefined });
    job.start();
  }

  private async runShareLinkExpiry(): Promise<void> {
    this.jobStatus.set('shareLinks', { isRunning: true, lastRun: new Date() });
    try {
      const cleared = await expireShareLinks(getDb());
      if (cleared > 0) {
        this.logger.info('Cleared expired conversation share links', { cleared });
      }
    } catch (error) {
      this.logger.error('Share link expiry sweep failed', error);
    } finally {
      this.jobStatus.set('shareLinks', { isRunning: false, lastRun: new Date() });
    }
  }

  /**
   * Setup city cover sync job — every 15 minutes while listing-linked covers
   * are still being replaced by Wikimedia cityscapes.
   */
  private setupCityCoverSyncJob(): void {
    const job = cron.schedule('*/15 * * * *', async () => {
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
   * Setup eviction outcome-reminder job — hourly. Nudges owners of `upcoming`
   * cases whose date is >24h past to record the real outcome (we never auto-flip
   * the status). Idempotent + best-effort (see evictionOutcomeReminderService).
   */
  private setupEvictionOutcomeReminderJob(): void {
    const job = cron.schedule('0 * * * *', async () => {
      await this.runEvictionOutcomeReminders();
    }, {
      timezone: 'UTC',
      scheduled: false,
    });

    this.jobs.set('evictionOutcomeReminders', job);
    this.jobStatus.set('evictionOutcomeReminders', { isRunning: true, lastRun: undefined, nextRun: undefined });
    job.start();
  }

  /**
   * Setup the expiry sweep — every five minutes.
   *
   * **This is the call `db/expiry.ts` says the registry does not make.** The
   * registry is data; nothing ran it, and a table registered there still grew
   * forever until this landed. Mongo reaped those rows with a TTL index — a
   * behaviour of the SOURCE that no code search can find, because it was never
   * in Homiio's code to be missed — and Postgres does not.
   *
   * The gap was not theoretical. Measured 2026-08-09, hours after the property
   * cutover: 124 listings in Postgres were past their deadline, 121 of them had
   * already been reaped from Mongo, and every one was still being served. The
   * intersection was exact — nothing was absent for any other reason — which is
   * what identifies the TTL index as the whole cause rather than one of several.
   *
   * ## Five minutes, not daily
   *
   * Mongo's TTL monitor runs every 60 seconds, so that is the cadence the read
   * paths were written against. `db/expiry.ts` warns that a read depending on a
   * swept row already being GONE turns the sweep interval into a correctness
   * window; five minutes keeps that window close to what the application has
   * always had, and the sweep is cheap — a range scan on an index that exists
   * precisely to support it.
   *
   * Every task runs this, and that is safe rather than tolerated: the delete is
   * idempotent, so two tasks sweeping concurrently costs a duplicate scan and
   * nothing else. It is the same argument the moderation reconciliation makes.
   */
  private setupExpirySweepJob(): void {
    const job = cron.schedule('*/5 * * * *', async () => {
      await this.runExpirySweep();
    }, {
      timezone: 'UTC',
      scheduled: false,
    });

    this.jobs.set('expirySweep', job);
    this.jobStatus.set('expirySweep', { isRunning: true, lastRun: undefined, nextRun: undefined });
    job.start();
  }

  /**
   * One sweep across every registered target.
   *
   * ## A sweep that reaped nothing is DISTINGUISHABLE from one that never ran
   *
   * That is the whole logging decision here, and it is the failure mode
   * `MIGRATION-CONTRACT.md` names for this class: an unwired sweep has no
   * symptom until disk. If the job only logged when it deleted something, a
   * silent log would mean either "nothing was due" or "the job is not
   * scheduled", and the second is invisible for months.
   *
   * So EVERY run logs, at `debug` when it reaped nothing and at `info` when it
   * did. `tablesSwept` is on both lines: a run that examined zero TABLES is a
   * broken registry, and it must not read like a quiet, healthy one.
   *
   * `truncated` is surfaced because the sweep stops at a ceiling per call. A run
   * that keeps reporting it is one that cannot keep up, which is a capacity
   * signal rather than an error — and it is the only way to tell "nothing left
   * to do" from "still working through a backlog".
   */
  /** The scheduled sweep, reachable on demand. See `runExpirySweepNow`. */
  async runExpirySweepNow(): Promise<void> {
    await this.runExpirySweep();
  }

  private async runExpirySweep(): Promise<void> {
    this.jobStatus.set('expirySweep', { isRunning: true, lastRun: new Date() });
    try {
      const results = await sweepAllExpiredRows(getDb(), EXPIRY_SWEEP_TARGETS);
      const deleted = results.reduce((total, result) => total + result.deleted, 0);
      const truncated = results.filter((result) => result.truncated).map((result) => result.table);
      const detail = {
        tablesSwept: results.length,
        deleted,
        perTable: Object.fromEntries(results.map((result) => [result.table, result.deleted])),
        truncated,
      };

      if (deleted > 0) this.logger.info('Expiry sweep reaped expired rows', detail);
      // Logged even at zero — see the doc comment. Silence would make an
      // unscheduled job look like a healthy one.
      else this.logger.debug('Expiry sweep found nothing due', detail);

      if (truncated.length > 0) {
        this.logger.warn(
          'Expiry sweep hit its batch ceiling; rows remain for the next run',
          { truncated },
        );
      }
    } catch (error) {
      this.logger.error('Expiry sweep failed', error);
    } finally {
      this.jobStatus.set('expirySweep', { isRunning: false, lastRun: new Date() });
    }
  }

  /**
   * The housing-watch jobs (#356): one queue drain and two digest windows.
   *
   * THREE schedules rather than one, because they answer different questions.
   * The matcher drains the event queue every two minutes so an `instant` watch
   * is instant enough to be worth the name; the digests close a cadence window
   * and are the reason there is no `last_digest_at` column anywhere — the
   * SCHEDULE is the state, so two processes cannot disagree about whether a
   * window has closed.
   *
   * A duplicated run costs nothing: the second finds no `pending` rows, because
   * the first marked them `delivered` inside itself. A missed run costs a delay.
   * That asymmetry is what makes a scheduler an acceptable substitute for a
   * stored watermark here and would not be if the digest deleted anything.
   */
  private setupHousingAlertJobs(): void {
    const matcher = cron.schedule('*/2 * * * *', async () => {
      await this.runHousingAlertSweep();
    }, { timezone: 'UTC', scheduled: false });
    this.jobs.set('housingAlerts', matcher);
    this.jobStatus.set('housingAlerts', { isRunning: true, lastRun: undefined, nextRun: undefined });
    matcher.start();

    // 08:05 UTC — a morning digest, and five past so it cannot collide with the
    // top-of-hour jobs above on a task that has just started.
    const daily = cron.schedule('5 8 * * *', async () => {
      await this.runHousingDigest('daily');
    }, { timezone: 'UTC', scheduled: false });
    this.jobs.set('housingDigestDaily', daily);
    this.jobStatus.set('housingDigestDaily', { isRunning: true, lastRun: undefined, nextRun: undefined });
    daily.start();

    // Monday 08:15 UTC, ten minutes after the daily one so a task running both
    // does not start them in the same tick.
    const weekly = cron.schedule('15 8 * * 1', async () => {
      await this.runHousingDigest('weekly');
    }, { timezone: 'UTC', scheduled: false });
    this.jobs.set('housingDigestWeekly', weekly);
    this.jobStatus.set('housingDigestWeekly', { isRunning: true, lastRun: undefined, nextRun: undefined });
    weekly.start();
  }

  /** The scheduled matcher pass, reachable on demand. See `runHousingAlertSweepNow`. */
  async runHousingAlertSweepNow(): Promise<void> {
    await this.runHousingAlertSweep();
  }

  private async runHousingAlertSweep(): Promise<void> {
    this.jobStatus.set('housingAlerts', { isRunning: true, lastRun: new Date() });
    try {
      const result = await runHousingAlertSweep();
      // Logged on EVERY run, including the empty ones, for the reason the expiry
      // sweep next door spells out: silence from an unscheduled job and silence
      // from a quiet market are the same silence, and only one is a problem.
      if (result.claimed > 0) this.logger.info('Housing alert sweep completed', { ...result });
      else this.logger.debug('Housing alert sweep found nothing queued', { ...result });
      if (result.remaining > 0) {
        this.logger.warn('Housing alert events remain queued after the sweep', {
          remaining: result.remaining,
        });
      }
    } catch (error) {
      this.logger.error('Housing alert sweep failed', error);
    } finally {
      this.jobStatus.set('housingAlerts', { isRunning: false, lastRun: new Date() });
    }
  }

  private async runHousingDigest(cadence: 'daily' | 'weekly'): Promise<void> {
    const key = cadence === 'daily' ? 'housingDigestDaily' : 'housingDigestWeekly';
    this.jobStatus.set(key, { isRunning: true, lastRun: new Date() });
    try {
      const result = await deliverDueDigests(cadence);
      if (result.watches > 0) this.logger.info('Housing alert digest delivered', { ...result });
      else this.logger.debug('Housing alert digest had nothing to send', { ...result });
    } catch (error) {
      this.logger.error('Housing alert digest failed', error);
    } finally {
      this.jobStatus.set(key, { isRunning: false, lastRun: new Date() });
    }
  }

  /**
   * Setup the CrowdSource reconciliation sweep — every 15 minutes.
   *
   * The outbox DISPATCHER runs continuously on every task; this is the separate
   * question of whether the outbox still agrees with the reports. It re-derives
   * a delivery event for a report that lost one, and COUNTS the three
   * divergences it must not act on: dead-lettered deliveries (re-queueing would
   * spin), cases that have gone quiet, and reports stored with no route to
   * review at all.
   *
   * Skipped entirely when the integration is off — with nothing delivering,
   * every queued report would be counted as a divergence every quarter hour.
   */
  private setupModerationReconciliationJob(): void {
    if (!config.crowdSource.enabled) return;

    const job = cron.schedule('*/15 * * * *', async () => {
      await this.runModerationReconciliation();
    }, {
      timezone: 'UTC',
      scheduled: false,
    });

    this.jobs.set('moderationReconciliation', job);
    this.jobStatus.set('moderationReconciliation', { isRunning: true, lastRun: undefined, nextRun: undefined });
    job.start();
  }

  /**
   * One reconciliation sweep. Bounded and idempotent, so a second task running
   * it concurrently costs a duplicate scan and nothing else.
   */
  private async runModerationReconciliation(): Promise<void> {
    const status = this.jobStatus.get('moderationReconciliation');
    if (status) {
      status.lastRun = new Date();
      status.isRunning = true;
    }

    try {
      await reconcileModerationReports();
    } catch (error) {
      // Logged, never rethrown: an unhandled rejection inside a cron tick takes
      // the process down, and a failed sweep is recoverable by the next one.
      this.logger.error('Moderation reconciliation sweep failed', error);
    } finally {
      if (status) status.isRunning = false;
    }
  }

  /**
   * Dispatch outcome reminders to owners of stale `upcoming` eviction cases.
   */
  private async runEvictionOutcomeReminders(): Promise<void> {
    const status = this.jobStatus.get('evictionOutcomeReminders');
    if (status) {
      status.lastRun = new Date();
      status.isRunning = true;
    }

    try {
      const { processed } = await sendEvictionOutcomeReminders(100);
      if (processed > 0) {
        this.logger.info('Eviction outcome reminders dispatched', { processed });
      }
    } catch (error) {
      this.logger.error('Eviction outcome reminders failed', error);
    }
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
 * Run the expiry sweep once, now.
 *
 * Exists so the scheduled path is REACHABLE without waiting five minutes — by a
 * test that needs to assert the cron passes the real registry, and by an
 * operator clearing a backlog after an incident.
 *
 * Without it the only testable claims are "a job named `expirySweep` is
 * scheduled" and "the registry works when called directly", and neither
 * connects the two: a job wired to an empty target list satisfies both. This is
 * the seam that makes the connection assertable.
 */
export async function runExpirySweepNow(): Promise<void> {
  await cronManager.runExpirySweepNow();
}

/**
 * Run the housing-alert matcher once, now.
 *
 * The same seam `runExpirySweepNow` exists for, and for the same reason: without
 * it the only testable claims are "a job named `housingAlerts` is scheduled" and
 * "the sweep works when called directly", and neither connects the two — a job
 * wired to nothing satisfies both.
 */
export async function runHousingAlertSweepNow(): Promise<void> {
  await cronManager.runHousingAlertSweepNow();
}

/**
 * Get cron job status
 */
export function getCronStatus(): Record<string, boolean> {
  return cronManager.getStatus();
}
