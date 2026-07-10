/**
 * Scraper Management Routes
 * API endpoints for managing external property scraping
 */

import express from 'express';
import { runExternalScrape, getScraperHealth, cleanupExpiredProperties, ScraperOptions } from '../services/scraperService';
import { asyncHandler } from '../middlewares';
import { requireAdmin } from '../middlewares/requireAdmin';

const router = express.Router();

// External ingestion management is admin-only. These routes are mounted under
// the authenticated router (server.ts), so `req.user` is resolved here; this
// gate additionally restricts them to configured platform admins.
router.use(requireAdmin);

/**
 * GET /api/scraper/health
 * Get scraper health status
 */
router.get('/health', asyncHandler(async (req: express.Request, res: express.Response) => {
  const health = await getScraperHealth();
  res.json({
    success: true,
    data: health
  });
}));

/**
 * POST /api/scraper/run
 * Manually trigger a scrape for a specific source
 * Body: { source, endpoint, transformerName?, timeout?, maxRetries?, batchSize?, ttlDays? }
 */
router.post('/run', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { source, endpoint, transformerName, timeout, maxRetries, batchSize, ttlDays } = req.body;

  if (!source || !endpoint) {
    return res.status(400).json({
      success: false,
      error: 'Source and endpoint are required'
    });
  }

  const options: ScraperOptions = {
    source,
    endpoint,
    transformerName,
    timeout,
    maxRetries,
    batchSize,
    ttlDays
  };

  const result = await runExternalScrape(options);
  
  res.json({
    success: true,
    data: result
  });
}));

/**
 * POST /api/scraper/cleanup
 * Clean up expired external properties
 * Body: { dryRun?: boolean }
 */
router.post('/cleanup', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { dryRun = true } = req.body;
  
  const result = await cleanupExpiredProperties(dryRun);
  
  res.json({
    success: true,
    data: {
      ...result,
      dryRun
    }
  });
}));

/**
 * GET /api/scraper/sources
 *
 * Legacy source list. The Fotocasa `localhost:3000` sidecar source has been
 * retired: external listing ingestion now runs in the dedicated worker via the
 * `@homiio/listing-providers` plugins (see `worker.ts`), not through a
 * hardcoded HTTP endpoint here. Returns an empty list so no stale sidecar
 * dependency is advertised.
 */
router.get('/sources', asyncHandler(async (req: express.Request, res: express.Response) => {
  res.json({
    success: true,
    data: [],
    message: 'Legacy scraper sources retired; external ingestion runs in the listing worker.',
  });
}));

export default () => router;
