import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales');
const LOCALES = ['en', 'es', 'ca-ES', 'it'] as const;

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
  const file = locale === 'en' ? 'en.json' : `${locale}.json`;
  return flattenKeys(JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as Record<string, unknown>);
}

const enKeys = loadKeys('en');
let failed = false;

for (const locale of LOCALES) {
  if (locale === 'en') continue;
  const missing = [...enKeys].filter((key) => !loadKeys(locale).has(key));
  if (missing.length > 0) {
    failed = true;
    console.error(`[${locale}] missing ${missing.length} keys from en`);
  }
}

if (failed) {
  console.error('Locale parity check FAILED.');
  process.exit(1);
}

console.log('Locale parity check passed.');
