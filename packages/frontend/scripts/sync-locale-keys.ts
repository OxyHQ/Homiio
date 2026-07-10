/**
 * Locale sync helpers:
 *   bun run scripts/sync-locale-keys.ts --register-fallbacks
 *   bun run scripts/sync-locale-keys.ts --copy-missing
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const LOCALES_DIR = join(import.meta.dir, '..', 'locales');
const FRONTEND_SRC = join(import.meta.dir, '..');
const LOCALES = ['en', 'es', 'ca-ES', 'it'] as const;

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flatten(obj: JsonObject, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(obj)) {
    if (prefix === '' && key.includes('.') && (typeof value === 'string' || Array.isArray(value))) {
      out.set(key, value);
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      for (const [k, v] of flatten(value, path)) {
        out.set(k, v);
      }
    } else {
      out.set(path, value);
    }
  }
  return out;
}

function getNested(obj: JsonObject, parts: string[]): unknown {
  let cursor: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cursor) || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setNested(obj: JsonObject, parts: string[], value: unknown): void {
  if (parts.length === 0) return;
  let cursor: JsonObject = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const next = cursor[part];
    if (!isPlainObject(next)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as JsonObject;
  }
  const leaf = parts[parts.length - 1];
  if (!(leaf in cursor)) {
    cursor[leaf] = value;
  }
}

function enUsesFlatKey(en: JsonObject, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(en, path);
}

function loadLocale(locale: (typeof LOCALES)[number]): JsonObject {
  const file = locale === 'en' ? 'en.json' : `${locale}.json`;
  return JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as JsonObject;
}

function saveLocale(locale: (typeof LOCALES)[number], data: JsonObject): void {
  const file = locale === 'en' ? 'en.json' : `${locale}.json`;
  writeFileSync(join(LOCALES_DIR, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function walkDir(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.expo') continue;
      walkDir(full, files);
    } else if (['.ts', '.tsx'].includes(extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

function extractFallbackKeys(): Map<string, string> {
  const pattern = /\bt\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*(?:\\.[^'"]*)*)['"]/g;
  const found = new Map<string, string>();
  for (const file of walkDir(FRONTEND_SRC)) {
    if (file.includes('/locales/') || file.includes('/scripts/')) continue;
    const source = readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const key = match[1];
      const fallback = match[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (key.includes('.')) {
        found.set(key, fallback);
      }
    }
  }
  return found;
}

function registerFallbacks(): void {
  const en = loadLocale('en');
  const enFlat = flatten(en);
  const fallbacks = extractFallbackKeys();
  let added = 0;
  for (const [key, fallback] of fallbacks) {
    if (!enFlat.has(key)) {
      if (enUsesFlatKey(en, key)) {
        en[key] = fallback;
      } else {
        setNested(en, key.split('.'), fallback);
      }
      enFlat.set(key, fallback);
      added += 1;
    }
  }
  if (added > 0) {
    saveLocale('en', en);
  }
  console.log(`Registered ${added} fallback keys in en.json (${fallbacks.size} total with fallbacks in code).`);
}

function copyMissingFromEn(): void {
  const en = loadLocale('en');
  const enFlat = flatten(en);
  for (const locale of LOCALES) {
    if (locale === 'en') continue;
    const target = loadLocale(locale);
    const targetFlat = flatten(target);
    let copied = 0;
    for (const [key, value] of enFlat) {
      if (targetFlat.has(key)) continue;
      if (enUsesFlatKey(en, key)) {
        target[key] = value;
      } else {
        setNested(target, key.split('.'), value);
      }
      copied += 1;
    }
    if (copied > 0) {
      saveLocale(locale, target);
    }
    console.log(`[${locale}] copied ${copied} missing keys from en.`);
  }
}

const arg = process.argv[2];
if (arg === '--register-fallbacks') {
  registerFallbacks();
} else if (arg === '--copy-missing') {
  copyMissingFromEn();
} else {
  console.log('Usage: bun run scripts/sync-locale-keys.ts --register-fallbacks | --copy-missing');
  process.exit(1);
}
