/**
 * City list parsing and discover pagination cap tests.
 */

import {
  citiesFromEnv,
  citiesOptionsFromEnv,
  DEFAULT_MARKET_CITIES,
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

  it('falls back to the ES market list when provider env is unset', () => {
    delete process.env.LISTING_FOTOCASA_CITIES;
    delete process.env.LISTING_ES_CITIES;
    const cities = fotocasaCitiesFromEnv();
    expect(cities).toEqual([...DEFAULT_MARKET_CITIES.ES]);
    expect(cities.length).toBeGreaterThan(10);
  });

  it('uses LISTING_ES_CITIES when provider env is unset but market env is set', () => {
    delete process.env.LISTING_FOTOCASA_CITIES;
    process.env.LISTING_ES_CITIES = 'madrid,barcelona,valencia';
    expect(fotocasaCitiesFromEnv()).toEqual(['madrid', 'barcelona', 'valencia']);
  });
});

describe('habitacliaCitiesFromEnv', () => {
  it('uses LISTING_HABITACLIA_CITIES when set', () => {
    process.env.LISTING_HABITACLIA_CITIES = 'madrid, barcelona';
    const { habitacliaCitiesFromEnv } = require('@homiio/listing-providers');
    expect(habitacliaCitiesFromEnv()).toEqual(['madrid', 'barcelona']);
  });

  it('falls back to the ES market list', () => {
    delete process.env.LISTING_HABITACLIA_CITIES;
    delete process.env.LISTING_ES_CITIES;
    const { habitacliaCitiesFromEnv } = require('@homiio/listing-providers');
    expect(habitacliaCitiesFromEnv()).toEqual([...DEFAULT_MARKET_CITIES.ES]);
  });
});

describe('pisosCitiesFromEnv', () => {
  it('uses LISTING_PISOS_CITIES when set', () => {
    process.env.LISTING_PISOS_CITIES = 'madrid, barcelona';
    const { pisosCitiesFromEnv } = require('@homiio/listing-providers');
    expect(pisosCitiesFromEnv()).toEqual(['madrid', 'barcelona']);
  });

  it('falls back to the ES market list', () => {
    delete process.env.LISTING_PISOS_CITIES;
    delete process.env.LISTING_ES_CITIES;
    const { pisosCitiesFromEnv } = require('@homiio/listing-providers');
    expect(pisosCitiesFromEnv()).toEqual([...DEFAULT_MARKET_CITIES.ES]);
    expect(pisosCitiesFromEnv().length).toBeGreaterThan(10);
  });
});

describe('idealistaCitiesFromEnv', () => {
  it('uses LISTING_IDEALISTA_CITIES when set', () => {
    process.env.LISTING_IDEALISTA_CITIES = 'madrid';
    const { idealistaCitiesFromEnv } = require('@homiio/listing-providers');
    expect(idealistaCitiesFromEnv()).toEqual(['madrid']);
  });

  it('falls back to the ES market list', () => {
    delete process.env.LISTING_IDEALISTA_CITIES;
    delete process.env.LISTING_ES_CITIES;
    const { idealistaCitiesFromEnv } = require('@homiio/listing-providers');
    expect(idealistaCitiesFromEnv()).toEqual([...DEFAULT_MARKET_CITIES.ES]);
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
