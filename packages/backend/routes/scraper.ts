/**
 * Scraper Management Routes
 * API endpoints for managing external property scraping
 */

import express from 'express';
import { runExternalScrape, getScraperHealth, cleanupExpiredProperties, ScraperOptions } from '../services/scraperService';
import { asyncHandler } from '../middlewares';

const router = express.Router();

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
 * Get available scraper sources and their configuration
 */
router.get('/sources', asyncHandler(async (req: express.Request, res: express.Response) => {
  const sources = [
    {
      source: 'fotocasa',
      endpoint: process.env.FOTOCASA_BASE || 'http://localhost:3000/search/all/barcelona',
      transformerName: 'fotocasa',
      enabled: true,
      description: 'Fotocasa property listings'
    }
    // Add more sources as they become available
  ];

  res.json({
    success: true,
    data: sources
  });
}));

export default () => router;
