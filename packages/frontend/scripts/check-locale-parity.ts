/**
 * Flatten nested locale JSON to dot-separated leaf keys and diff across locales.
 * Exit 1 when en/es/ca-ES/it are out of parity.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = join(import.meta.dir, '..', 'locales');
const LOCALES = ['en', 'es', 'ca-ES', 'it'] as const;
const FILE_BY_LOCALE: Record<(typeof LOCALES)[number], string> = {
  en: 'en.json',
  es: 'es.json',
  'ca-ES': 'ca-ES.json',
  it: 'it.json',
};

function flattenKeys(obj: Record<string, unknown>, prefix = ''): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    if (prefix === '' && key.includes('.') && (typeof value === 'string' || Array.isArray(value))) {
      keys.add(key);
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const nested of flattenKeys(value as Record<string, unknown>, path)) {
        keys.add(nested);
      }
    } else {
      keys.add(path);
    }
  }
  return keys;
}

function loadKeys(locale: (typeof LOCALES)[number]): Set<string> {
  const filePath = join(LOCALES_DIR, FILE_BY_LOCALE[locale]);
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return flattenKeys(parsed);
}

function diff(base: Set<string>, other: Set<string>): string[] {
  return [...base].filter((key) => !other.has(key)).sort();
}

function main(): void {
  const keySets = Object.fromEntries(
    LOCALES.map((locale) => [locale, loadKeys(locale)]),
  ) as Record<(typeof LOCALES)[number], Set<string>>;

  const enKeys = keySets.en;
  let failed = false;

  console.log('Locale leaf key counts:');
  for (const locale of LOCALES) {
    console.log(`  ${locale}: ${keySets[locale].size}`);
  }
  console.log('');

  for (const locale of LOCALES) {
    if (locale === 'en') continue;
    const missing = diff(enKeys, keySets[locale]);
    const extra = diff(keySets[locale], enKeys);
    if (missing.length > 0) {
      failed = true;
      console.error(`[${locale}] missing ${missing.length} keys from en:`);
      for (const key of missing.slice(0, 50)) {
        console.error(`  - ${key}`);
      }
      if (missing.length > 50) {
        console.error(`  ... and ${missing.length - 50} more`);
      }
      console.error('');
    }
    if (extra.length > 0) {
      console.warn(`[${locale}] ${extra.length} orphan keys (not in en):`);
      for (const key of extra.slice(0, 20)) {
        console.warn(`  - ${key}`);
      }
      if (extra.length > 20) {
        console.warn(`  ... and ${extra.length - 20} more`);
      }
      console.warn('');
    }
  }

  if (failed) {
    console.error('Locale parity check FAILED.');
    process.exit(1);
  }

  console.log('Locale parity check passed.');
}

main();
