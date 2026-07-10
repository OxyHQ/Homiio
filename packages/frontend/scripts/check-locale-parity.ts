import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales');
const LOCALES = ['en', 'es', 'ca-ES', 'it'] as const;
const FILE_BY_LOCALE: Record<(typeof LOCALES)[number], string> = {
  en: 'en.json', es: 'es.json', 'ca-ES': 'ca-ES.json', it: 'it.json',
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
      for (const nested of flattenKeys(value as Record<string, unknown>, path)) keys.add(nested);
    } else keys.add(path);
  }
  return keys;
}

function loadKeys(locale: (typeof LOCALES)[number]): Set<string> {
  return flattenKeys(JSON.parse(readFileSync(join(LOCALES_DIR, FILE_BY_LOCALE[locale]), 'utf8')));
}

const enKeys = loadKeys('en');
let failed = false;
for (const locale of LOCALES) {
  if (locale === 'en') continue;
  const missing = [...enKeys].filter((k) => !loadKeys(locale).has(k));
  if (missing.length) {
    failed = true;
    console.error(`[${locale}] missing ${missing.length} keys`);
  }
}
if (failed) process.exit(1);
console.log('Locale parity check passed.');
