/**
 * Sync DEFAULT_MARKET_CITIES → oxy-infra worker env data files (comma-separated).
 * Re-run after editing defaultMarketCities.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MARKET_CITIES } from '../src/parse/defaultMarketCities';

const outDir = join(
  import.meta.dirname,
  '../../../../oxy-infra/terraform-uswest2/data/homiio-listing-cities',
);

mkdirSync(outDir, { recursive: true });

for (const [market, cities] of Object.entries(DEFAULT_MARKET_CITIES)) {
  const path = join(outDir, `${market.toLowerCase()}.txt`);
  writeFileSync(path, `${cities.join(',')}\n`);
  process.stdout.write(`${market}: ${cities.length} cities → ${path}\n`);
}
