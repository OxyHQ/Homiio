/**
 * Scraper Management Routes
 * API endpoints for managing external property scraping
 */

import express from 'express';
import {
  runExternalScrape,
  getScraperHealth,
  cleanupExpiredProperties,
  type ScraperOptions,
} from '../services/scraperService';
import { asyncHandler } from '../middlewares';
import { SCRAPER_OPERATE_PERMISSION } from '../services/applicationPermissions';
import { oxyService } from '../services/oxy';

const router = express.Router();

// External ingestion tooling is for the people Homiio's Oxy application grants
// `homiio.scraper.operate`, read fresh on every call (these routes write and
// fetch caller-chosen URLs). Everyone else, a service token included, gets 404;
// an Oxy outage is 503, never a cached "no" (`~/Oxy/docs/application-roles.md`).
router.use(oxyService.middleware.requireAppPermission(SCRAPER_OPERATE_PERMISSION, { fresh: true }));

/**
 * GET /api/scraper/health
 * Get scraper health status
 */
router.get(
  '/health',
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const health = await getScraperHealth();
    res.json({
      success: true,
      data: health,
    });
  }),
);

/**
 * POST /api/scraper/run
 * Manually trigger a scrape for a specific source
 * Body: { source, endpoint, transformerName?, timeout?, maxRetries?, batchSize?, ttlDays? }
 */
router.post(
  '/run',
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { source, endpoint, transformerName, timeout, maxRetries, batchSize, ttlDays } = req.body;

    if (!source || !endpoint) {
      return res.status(400).json({
        success: false,
        error: 'Source and endpoint are required',
      });
    }

    const options: ScraperOptions = {
      source,
      endpoint,
      transformerName,
      timeout,
      maxRetries,
      batchSize,
      ttlDays,
    };

    const result = await runExternalScrape(options);

    res.json({
      success: true,
      data: result,
    });
  }),
);

/**
 * POST /api/scraper/cleanup
 * Clean up expired external properties
 * Body: { dryRun?: boolean }
 */
router.post(
  '/cleanup',
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { dryRun = true } = req.body;

    const result = await cleanupExpiredProperties(dryRun);

    res.json({
      success: true,
      data: {
        ...result,
        dryRun,
      },
    });
  }),
);

/**
 * GET /api/scraper/sources
 *
 * Legacy source list. The Fotocasa `localhost:3000` sidecar source has been
 * retired: external listing ingestion now runs in the dedicated worker via the
 * `@homiio/listing-providers` plugins (see `worker.ts`), not through a
 * hardcoded HTTP endpoint here. Returns an empty list so no stale sidecar
 * dependency is advertised.
 */
router.get(
  '/sources',
  asyncHandler(async (req: express.Request, res: express.Response) => {
    res.json({
      success: true,
      data: [],
      message: 'Legacy scraper sources retired; external ingestion runs in the listing worker.',
    });
  }),
);

export default () => router;
