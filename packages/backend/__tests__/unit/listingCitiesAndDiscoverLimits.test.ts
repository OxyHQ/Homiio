/**
 * City list parsing and discover pagination cap tests.
 */

import {
  citiesFromEnv,
  citiesOptionsFromEnv,
  DEFAULT_MARKET_CITIES,
  FOTOCASA_DEFAULT_CITIES,
  fotocasaCitiesFromEnv,
  MAX_PAGES_CEILING,
  maxSearchPagesFromEnv,
  providerMaxSearchPages,
} from '@homiio/listing-providers';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(() => {
  restoreEnv();
});

describe('citiesFromEnv', () => {
  it('returns env override when LISTING_ES_CITIES is set', () => {
    process.env.LISTING_ES_CITIES = 'madrid, barcelona';
    expect(citiesFromEnv('ES')).toEqual(['madrid', 'barcelona']);
  });

  it('falls back to bundled defaults when env is empty', () => {
    delete process.env.LISTING_ES_CITIES;
    const cities = citiesFromEnv('ES');
    expect(cities.length).toBeGreaterThanOrEqual(DEFAULT_MARKET_CITIES.ES.length);
    expect(cities).toContain('madrid');
    expect(cities).toContain('barcelona');
  });

  it('parses US City, ST pairs from comma-separated env', () => {
    process.env.LISTING_US_CITIES = 'Austin, TX,Miami, FL,New York, NY';
    expect(citiesFromEnv('US')).toEqual(['Austin, TX', 'Miami, FL', 'New York, NY']);
  });

  it('parses US cities from pipe-separated env', () => {
    process.env.LISTING_US_CITIES = 'Austin, TX| Miami, FL ';
    expect(citiesFromEnv('US')).toEqual(['Austin, TX', 'Miami, FL']);
  });

  it('citiesOptionsFromEnv always returns a non-empty cities array', () => {
    delete process.env.LISTING_GB_CITIES;
    const options = citiesOptionsFromEnv('GB');
    expect(options.cities.length).toBeGreaterThan(10);
    expect(options.cities).toContain('London');
  });
});

describe('fotocasaCitiesFromEnv', () => {
  it('uses LISTING_FOTOCASA_CITIES when set', () => {
    process.env.LISTING_FOTOCASA_CITIES = 'madrid, barcelona';
    expect(fotocasaCitiesFromEnv()).toEqual(['madrid', 'barcelona']);
  });

  it('falls back to Fotocasa defaults, not the full ES market list', () => {
    delete process.env.LISTING_FOTOCASA_CITIES;
    process.env.LISTING_ES_CITIES = 'madrid,barcelona,valencia,sevilla,malaga,bilbao,zaragoza,alicante,murcia,palma,las-palmas-de-gran-canaria';
    const cities = fotocasaCitiesFromEnv();
    expect(cities).toEqual([...FOTOCASA_DEFAULT_CITIES]);
    expect(cities.length).toBe(3);
  });
});

describe('discover pagination caps', () => {
  it('clamps env page caps to MAX_PAGES_CEILING', () => {
    process.env.LISTING_TEST_MAX = '9999';
    expect(maxSearchPagesFromEnv('LISTING_TEST_MAX', 3)).toBe(MAX_PAGES_CEILING);
  });

  it('uses provider-specific env before market fallback', () => {
    process.env.LISTING_FOTOCASA_MAX_PAGES = '120';
    process.env.LISTING_ES_MAX_PAGES = '40';
    expect(providerMaxSearchPages('fotocasa', 75, 'ES')).toBe(120);
  });

  it('uses market-wide LISTING_ES_MAX_PAGES when provider env unset', () => {
    delete process.env.LISTING_IDEALISTA_MAX_PAGES;
    process.env.LISTING_ES_MAX_PAGES = '80';
    expect(providerMaxSearchPages('idealista', 50, 'ES')).toBe(80);
  });

  it('falls back to provider default when no env caps set', () => {
    delete process.env.LISTING_RIGHTMOVE_MAX_PAGES;
    delete process.env.LISTING_GB_MAX_PAGES;
    expect(providerMaxSearchPages('rightmove', 50, 'GB')).toBe(50);
  });
});
