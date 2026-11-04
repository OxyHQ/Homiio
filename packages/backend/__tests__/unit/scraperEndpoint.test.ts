/**
 * What `POST /api/scraper/run` may fetch: the origin allowlist.
 *
 * `endpoint` comes straight off the request body and the process runs inside
 * the VPC. The allowlist is the first layer; `safeFetch` (internal addresses
 * refused at connect time, no redirect followed) is the second, and
 * `__tests__/integration/scraperRoutes.test.ts` proves the scraper goes through it.
 */

import { AppError } from '../../middlewares/errorHandler';
import {
  assertAllowedScraperEndpoint,
  scraperAllowedOrigins,
} from '../../services/scraperEndpoint';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function refusal(endpoint: string): AppError | undefined {
  try {
    assertAllowedScraperEndpoint(endpoint);
    return undefined;
  } catch (error) {
    return error as AppError;
  }
}

describe('assertAllowedScraperEndpoint', () => {
  it('refuses everything, as a 400, when no origins are configured', () => {
    // The default must be "none", not "any": a default of any host is what made
    // the finding critical.
    delete process.env.SCRAPER_ALLOWED_ORIGINS;
    expect(scraperAllowedOrigins().size).toBe(0);
    const error = refusal('https://feeds.example.com/x');
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 400, code: 'SCRAPER_ENDPOINT_REFUSED' });
  });

  it('allows exactly the configured origin and nothing beside it', () => {
    process.env.SCRAPER_ALLOWED_ORIGINS = 'https://feeds.example.com';
    expect(assertAllowedScraperEndpoint('https://feeds.example.com/listings.json').origin).toBe(
      'https://feeds.example.com',
    );
    for (const blocked of [
      'https://feeds.example.com.evil.test/x', // suffix trick
      'https://evil.test/?x=https://feeds.example.com', // substring trick
      'http://feeds.example.com/x', // scheme differs -> different origin
      'https://feeds.example.com:8443/x', // port differs -> different origin
    ]) {
      expect(refusal(blocked)).toBeInstanceOf(AppError);
    }
  });

  it('refuses non-http schemes and embedded credentials', () => {
    process.env.SCRAPER_ALLOWED_ORIGINS = 'https://feeds.example.com';
    for (const blocked of [
      'file:///etc/passwd',
      'gopher://feeds.example.com/x',
      'https://user:pass@feeds.example.com/x',
      'not-a-url',
    ]) {
      expect(refusal(blocked)).toBeInstanceOf(AppError);
    }
  });
});
