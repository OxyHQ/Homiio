import axios from 'axios';
import { OfferingType } from '@homiio/shared-types';
import { forwardGeocode } from './geocodingService';
import { Property } from '../models';
import { logger as appLogger } from '../middlewares/logging';

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorCodeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function errorStatusOf(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    const resp = (error as { response?: { status?: unknown } }).response;
    if (resp && typeof resp === 'object' && typeof resp.status === 'number') {
      return resp.status;
    }
  }
  return undefined;
}

interface ExternalRawImage { url?: string; caption?: string; isPrimary?: boolean }

interface ExternalRawAddress {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  coordinates?: { lat: number; lng: number };
}

interface ExternalRawListing {
  id?: string;
  sourceUrl?: string;
  url?: string;
  address?: ExternalRawAddress;
  rent?: { amount?: number; currency?: string };
  description?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  floor?: number;
  type?: string;
  hasBalcony?: boolean;
  amenities?: string[];
  furnishedStatus?: string;
  availableFrom?: string;
  images?: ExternalRawImage[];
  status?: string;
  [key: string]: unknown;
}

// Configuration constants
const SCRAPER_CONFIG = {
  DEFAULT_TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  BATCH_SIZE: 50,
  DEFAULT_TTL_DAYS: 30,
  MAX_DESCRIPTION_LENGTH: 2000,
  REQUEST_DELAY: 500, // Delay between requests to avoid rate limiting
};

export interface ScrapeResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  totalProcessed: number;
  duration: number;
  errorDetails: Array<{
    id?: string;
    error: string;
    timestamp: Date;
  }>;
}

export interface ScraperOptions {
  source: string;
  endpoint: string;
  apiKey?: string;
  transformerName?: string;

  timeout?: number;
  maxRetries?: number;
  batchSize?: number;
  ttlDays?: number;
}

// Enhanced logging utility
class ScraperLogger {
  private source: string;

  constructor(source: string) {
    this.source = source;
  }

  info(message: string, data?: unknown): void {
    appLogger.info(`[Scraper:${this.source}] ${message}`, data === undefined ? {} : { data });
  }

  warn(message: string, data?: unknown): void {
    appLogger.warn(`[Scraper:${this.source}] ${message}`, data === undefined ? {} : { data });
  }

  error(message: string, error?: unknown): void {
    appLogger.error(`[Scraper:${this.source}] ${message}`, error === undefined ? {} : { error });
  }

  debug(message: string, data?: unknown): void {
    appLogger.debug(`[Scraper:${this.source}] ${message}`, data === undefined ? {} : { data });
  }
}

// Enhanced validation functions
function validateExternalProperty(raw: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!raw?.id) errors.push('Missing required field: id');
  if (!raw?.address) {
    errors.push('Missing required field: address');
  } else {
    if (!raw.address.street) errors.push('Missing required field: address.street');
    if (!raw.address.city) errors.push('Missing required field: address.city');
    if (!raw.address.state) errors.push('Missing required field: address.state');
    if (!raw.address.zipCode) errors.push('Missing required field: address.zipCode');
  }
  if (!raw?.rent) {
    errors.push('Missing required field: rent');
  } else {
    if (!raw.rent.amount || raw.rent.amount <= 0) errors.push('Invalid rent amount');
  }

  // Validate coordinates if provided
  if (raw.address?.coordinates) {
    const { lat, lng } = raw.address.coordinates;
    if (lat < -90 || lat > 90) errors.push('Invalid latitude');
    if (lng < -180 || lng > 180) errors.push('Invalid longitude');
  }

  return { isValid: errors.length === 0, errors };
}

function sanitizeData(raw: any): any {
  return {
    ...raw,
    description: raw.description ? 
      raw.description.slice(0, SCRAPER_CONFIG.MAX_DESCRIPTION_LENGTH).trim() : 
      undefined,
    // Ensure numeric fields are valid
    bedrooms: Math.max(0, raw.bedrooms || 0),
    bathrooms: Math.max(0, raw.bathrooms || 0),
    squareFootage: Math.max(0, raw.squareFootage || 0),
    floor: raw.floor ? Math.max(0, raw.floor) : undefined,
    rent: {
      ...raw.rent,
      amount: Math.max(0, raw.rent?.amount || 0),
    },
  };
}
/**
 * Map a raw scraped listing into (a) the canonical Address input — building
 * fields + coordinates + geo NAMES used to resolve the relational geo id chain —
 * and (b) the Property fields. Geo is relational, so the address is never
 * embedded on the Property; the upserter resolves it to an `addressId`.
 */
function mapToProperty(raw: any): { property: Record<string, unknown>; addressInput: Record<string, unknown> } {
  try {
    const addressInput = {
      street: raw.address?.street || '',
      postal_code: raw.address?.zipCode || raw.address?.postal_code || '',
      // Place NAMES — resolved to country/region/city/neighborhood ids, not stored as text.
      city: raw.address?.city || '',
      state: raw.address?.state || '',
      country: raw.address?.country || 'Spain',
      neighborhood: raw.address?.neighborhood || '',
      coordinates: raw.address?.coordinates
        ? { type: 'Point', coordinates: [raw.address.coordinates.lng, raw.address.coordinates.lat] }
        : undefined,
    };

    const property = {
      description: raw.description || '',
      type: raw.type || 'apartment',
      bedrooms: raw.bedrooms ?? 0,
      bathrooms: raw.bathrooms ?? 0,
      squareFootage: raw.squareFootage ?? 0,
      floor: raw.floor ?? 0,
      hasElevator: !!raw.hasElevator,
      hasBalcony: !!raw.hasBalcony,
      // External listings (Idealista/Fotocasa-style) are long-term rentals: map
      // the scraped rent into the long_term_rent offering block.
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: {
        monthlyAmount: raw.rent?.amount ?? 0,
        currency: raw.rent?.currency ?? 'EUR'
      },
      amenities: Array.isArray(raw.amenities) ? raw.amenities : [],
      furnishedStatus: raw.furnishedStatus ?? 'unfurnished',
      availableFrom: raw.availableFrom,
      images: Array.isArray(raw.images)
        ? raw.images.map((img: ExternalRawImage, idx: number) => ({
            url: img.url,
            caption: img.caption,
            isPrimary: !!img.isPrimary || idx === 0
          }))
        : [],
      // External aggregator listings are published (visible in search). The
      // Property status enum has no 'active' member — 'published' is correct.
      status: raw.status ?? 'published',
    };

    return { property, addressInput };
  } catch (error) {
    throw new Error(`Failed to map property data: ${errorMessageOf(error)}`);
  }
}

// Enhanced upsert with retry logic and better error handling
export async function upsertExternalListing(
  raw: any, 
  source: string, 
  logger: ScraperLogger,
  ttlDays: number = SCRAPER_CONFIG.DEFAULT_TTL_DAYS
): Promise<{ status: 'created' | 'updated' | 'error'; error?: string }> {
  const maxRetries = SCRAPER_CONFIG.MAX_RETRIES;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Validate and sanitize data
      const validation = validateExternalProperty(raw);
      if (!validation.isValid) {
        return { 
          status: 'error', 
          error: `Validation failed: ${validation.errors.join(', ')}` 
        };
      }

      const sanitized = sanitizeData(raw);
      const { property: mapped, addressInput } = mapToProperty(sanitized);

      // Resolve the canonical building Address (relational geo). Coordinates are
      // required; when the source omits them, forward-geocode the address once.
      if (!addressInput.coordinates) {
        const query = [addressInput.street, addressInput.city, addressInput.state, addressInput.postal_code, addressInput.country]
          .filter(Boolean)
          .join(', ');
        const geocoded = await forwardGeocode(query);
        if (!geocoded.success || !geocoded.data?.coordinates) {
          return { status: 'error', error: 'Could not resolve coordinates for the external listing address' };
        }
        addressInput.coordinates = { type: 'Point', coordinates: geocoded.data.coordinates };
      }
      const { Address } = require('../models');
      const address = await Address.findOrCreateCanonical(addressInput);

      const update = {
        ...mapped,
        addressId: address._id,
        source,
        sourceId: raw.id,
        // Always record the canonical source URL (the aggregator CTA target).
        sourceUrl: raw.sourceUrl || raw.url,
        isExternal: true,
        // Extend TTL by resetting expiresAt each refresh
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
      };

      const existing = await Property.findOne({ source, sourceId: raw.id });
      
      if (existing) {
        await Property.updateOne({ _id: existing._id }, { $set: update });
        logger.debug(`Updated existing property: ${raw.id}`);
        return { status: 'updated' };
      } else {
        await Property.create(update);
        logger.debug(`Created new property: ${raw.id}`);
        return { status: 'created' };
      }
    } catch (error) {
      lastError = error;
      logger.warn(`Upsert attempt ${attempt} failed for ${raw.id}:`, errorMessageOf(error));
      
      if (attempt < maxRetries) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, SCRAPER_CONFIG.RETRY_DELAY * attempt));
      }
    }
  }

  const errorMessage = `Failed after ${maxRetries} attempts: ${errorMessageOf(lastError) || 'Unknown error'}`;
  logger.error(`Upsert failed for ${raw.id}:`, errorMessage);
  return { status: 'error', error: errorMessage };
}

// Helper function to make HTTP requests with retry logic
async function makeRequest(
  url: string, 
  options: { apiKey?: string; timeout?: number; maxRetries?: number },
  logger: ScraperLogger
): Promise<any> {
  const maxRetries = options.maxRetries || SCRAPER_CONFIG.MAX_RETRIES;
  const timeout = options.timeout || SCRAPER_CONFIG.DEFAULT_TIMEOUT;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`Making request to ${url} (attempt ${attempt})`);
      
      const response = await axios.get(url, {
        headers: options.apiKey ? { 'Authorization': `Bearer ${options.apiKey}` } : {},
        timeout,
        validateStatus: (status) => status < 500, // Don't throw for 4xx errors
      });

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.data;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const code = errorCodeOf(error);
      const status = errorStatusOf(error);
      const shouldRetry = code === 'ECONNRESET' ||
                         code === 'ETIMEDOUT' ||
                         (status !== undefined && status >= 500);

      if (!shouldRetry || isLastAttempt) {
        throw error;
      }

      logger.warn(`Request attempt ${attempt} failed, retrying:`, errorMessageOf(error));
      await new Promise(resolve => setTimeout(resolve, SCRAPER_CONFIG.RETRY_DELAY * attempt));
    }
  }
}

// Process listings in batches for better performance
interface BatchErrorDetail { id?: string; error: string; timestamp: Date }
interface BatchResult { created: number; updated: number; errors: number; errorDetails: BatchErrorDetail[] }

async function processBatch(
  listings: ExternalRawListing[],
  source: string,
  logger: ScraperLogger,
  ttlDays: number
): Promise<BatchResult> {
  const batchResult: BatchResult = { created: 0, updated: 0, errors: 0, errorDetails: [] };

  const promises = listings.map(async (raw) => {
    if (!raw?.id || !raw.address || !raw.rent) {
      return { status: 'skipped', reason: 'Missing required fields' };
    }

    try {
      const upsertResult = await upsertExternalListing(raw, source, logger, ttlDays);
      return upsertResult;
    } catch (error) {
      logger.error(`Failed to process listing ${raw.id}:`, errorMessageOf(error));
      return { status: 'error', error: errorMessageOf(error) };
    }
  });

  const results = await Promise.allSettled(promises);
  
  results.forEach((promiseResult, index) => {
    if (promiseResult.status === 'fulfilled') {
      const value = promiseResult.value;
      if (value.status === 'created') {
        batchResult.created++;
      } else if (value.status === 'updated') {
        batchResult.updated++;
      } else if (value.status === 'error') {
        batchResult.errors++;
        batchResult.errorDetails.push({
          id: listings[index]?.id,
          error: ('error' in value && typeof value.error === 'string') ? value.error : 'Unknown error',
          timestamp: new Date()
        });
      }
    } else {
      batchResult.errors++;
      batchResult.errorDetails.push({
        id: listings[index]?.id,
        error: errorMessageOf(promiseResult.reason),
        timestamp: new Date()
      });
    }
  });

  return batchResult;
}

export async function runExternalScrape(options: ScraperOptions): Promise<ScrapeResult> {
  const startTime = Date.now();
  const logger = new ScraperLogger(options.source);
  const batchSize = options.batchSize || SCRAPER_CONFIG.BATCH_SIZE;
  const ttlDays = options.ttlDays || SCRAPER_CONFIG.DEFAULT_TTL_DAYS;
  
  const result: ScrapeResult = { 
    created: 0, 
    updated: 0, 
    skipped: 0, 
    errors: 0, 
    totalProcessed: 0,
    duration: 0,
    errorDetails: []
  };

  try {
    logger.info(`Starting scrape from ${options.endpoint}`);
    
    // Make API request with retry logic
    const data = await makeRequest(options.endpoint, {
      apiKey: options.apiKey,
      timeout: options.timeout,
      maxRetries: options.maxRetries
    }, logger);

    // API now returns data in the correct format
    const listings: any[] = Array.isArray(data) ? data : data?.listings || [];

    logger.info(`Found ${listings.length} listings to process`);
    result.totalProcessed = listings.length;

    if (listings.length === 0) {
      logger.warn('No listings found in API response');
      return { ...result, duration: Date.now() - startTime };
    }

    // Process in batches to avoid overwhelming the database
    for (let i = 0; i < listings.length; i += batchSize) {
      const batch = listings.slice(i, i + batchSize);
      logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} items)`);
      
      // Add delay between batches to be respectful to the database
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, SCRAPER_CONFIG.REQUEST_DELAY));
      }

      const batchResult = await processBatch(batch, options.source, logger, ttlDays);
      
      result.created += batchResult.created;
      result.updated += batchResult.updated;
      result.errors += batchResult.errors;
      result.errorDetails.push(...batchResult.errorDetails);
    }

    result.skipped = result.totalProcessed - result.created - result.updated - result.errors;
    result.duration = Date.now() - startTime;

    logger.info(`Scrape completed in ${result.duration}ms:`, {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      totalProcessed: result.totalProcessed
    });

  } catch (error) {
    result.duration = Date.now() - startTime;
    logger.error('Scrape failed:', errorMessageOf(error));
    result.errorDetails.push({
      error: `Scrape failed: ${errorMessageOf(error)}`,
      timestamp: new Date()
    });
  }

  return result;
}

// Health check utilities
export async function getScraperHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  details: {
    externalPropertyCount: number;
    lastScrapeErrors: number;
    oldestExternalProperty: Date | null;
  };
}> {
  try {
    const externalProperties = await Property.find({ isExternal: true }).sort({ updatedAt: -1 }).limit(1);
    const externalPropertyCount = await Property.countDocuments({ isExternal: true });
    const oldestProperty = await Property.findOne({ isExternal: true }).sort({ updatedAt: 1 });
    
    // Simple health assessment
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (externalPropertyCount === 0) {
      status = 'unhealthy';
    } else if (oldestProperty && new Date(oldestProperty.updatedAt) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
      status = 'degraded'; // No updates in 7 days
    }

    return {
      status,
      details: {
        externalPropertyCount,
        lastScrapeErrors: 0, // Could be implemented with error tracking
        oldestExternalProperty: oldestProperty?.updatedAt || null,
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      details: {
        externalPropertyCount: 0,
        lastScrapeErrors: 1,
        oldestExternalProperty: null,
      }
    };
  }
}

// Clean up expired external properties (manual cleanup if TTL doesn't work)
export async function cleanupExpiredProperties(dryRun: boolean = true): Promise<{
  deleted: number;
  errors: number;
}> {
  const logger = new ScraperLogger('cleanup');
  
  try {
    const expiredQuery = {
      isExternal: true,
      expiresAt: { $lt: new Date() }
    };

    if (dryRun) {
      const count = await Property.countDocuments(expiredQuery);
      logger.info(`Would delete ${count} expired external properties`);
      return { deleted: count, errors: 0 };
    } else {
      const result = await Property.deleteMany(expiredQuery);
      logger.info(`Deleted ${result.deletedCount} expired external properties`);
      return { deleted: result.deletedCount, errors: 0 };
    }
  } catch (error) {
    logger.error('Failed to cleanup expired properties:', error);
    return { deleted: 0, errors: 1 };
  }
}

/**
 * ScraperService class that wraps the existing scraper functions
 */
export class ScraperService {
  private logger: ScraperLogger;

  constructor() {
    this.logger = new ScraperLogger('ScraperService');
  }

  /**
   * Run external scraping with the given options
   */
  async runExternalScrape(options: ScraperOptions): Promise<ScrapeResult> {
    try {
      this.logger.debug('Starting external scrape', { source: options.source, endpoint: options.endpoint });
      const result = await runExternalScrape(options);
      this.logger.debug('External scrape completed', { 
        source: options.source, 
        created: result.created, 
        updated: result.updated,
        errors: result.errors 
      });
      return result;
    } catch (error) {
      this.logger.error('External scrape failed', error);
      throw error;
    }
  }

  /**
   * Upsert an external listing
   */
  async upsertExternalListing(listing: any, source: string): Promise<{
    created: boolean;
    propertyId: string;
  }> {
    try {
      this.logger.debug('Upserting external listing', { source, id: listing.id });
      const result = await upsertExternalListing(listing, source, this.logger);
      this.logger.debug('External listing upserted', { 
        source, 
        id: listing.id, 
        created: result.status === 'created' 
      });
      return { 
        created: result.status === 'created', 
        propertyId: listing.id
      };
    } catch (error) {
      this.logger.error('Failed to upsert external listing', error);
      throw error;
    }
  }

  /**
   * Get scraper health status
   */
  async getScraperHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: {
      externalPropertyCount: number;
      lastScrapeErrors: number;
      oldestExternalProperty: Date | null;
    };
  }> {
    try {
      this.logger.debug('Getting scraper health');
      const health = await getScraperHealth();
      this.logger.debug('Scraper health retrieved', health);
      return health;
    } catch (error) {
      this.logger.error('Failed to get scraper health', error);
      throw error;
    }
  }

  /**
   * Clean up expired properties
   */
  async cleanupExpiredProperties(dryRun: boolean = true): Promise<{
    deleted: number;
    errors: number;
  }> {
    try {
      this.logger.debug(`Cleaning up expired properties (dryRun: ${dryRun})`);
      const result = await cleanupExpiredProperties(dryRun);
      this.logger.debug('Expired properties cleanup completed', result);
      return result;
    } catch (error) {
      this.logger.error('Failed to cleanup expired properties', error);
      throw error;
    }
  }
}
