import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(SCRIPT_DIR, '..', 'locales');
const FRONTEND_SRC = join(SCRIPT_DIR, '..');
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
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

function setNested(obj: JsonObject, parts: string[], value: unknown): void {
  let cursor: JsonObject = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!isPlainObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as JsonObject;
  }
  cursor[parts[parts.length - 1]] = value;
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
    if (statSync(full).isDirectory()) {
      if (['node_modules', 'dist', '.expo'].includes(entry)) continue;
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
      if (key.includes('.')) {
        found.set(key, match[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
      }
    }
  }
  return found;
}

function registerFallbacks(): void {
  const en = loadLocale('en');
  const enFlat = flatten(en);
  let added = 0;
  for (const [key, fallback] of extractFallbackKeys()) {
    if (enFlat.has(key)) continue;
    if (enUsesFlatKey(en, key)) en[key] = fallback;
    else setNested(en, key.split('.'), fallback);
    enFlat.set(key, fallback);
    added += 1;
  }
  if (added > 0) saveLocale('en', en);
  console.log(`Registered ${added} fallback keys in en.json.`);
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
      if (enUsesFlatKey(en, key)) target[key] = value;
      else setNested(target, key.split('.'), value);
      copied += 1;
    }
    if (copied > 0) saveLocale(locale, target);
    console.log(`[${locale}] copied ${copied} missing keys from en.`);
  }
}

const arg = process.argv[2];
if (arg === '--register-fallbacks') registerFallbacks();
else if (arg === '--copy-missing') copyMissingFromEn();
else {
  console.log('Usage: bun run scripts/sync-locale-keys.ts --register-fallbacks | --copy-missing');
  process.exit(1);
}
