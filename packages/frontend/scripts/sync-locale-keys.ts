/**
 * Copy missing keys from en.json into es/ca-ES/it (English placeholder for manual translation).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales');
type JsonObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
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
    } else out.set(path, value);
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

const en = JSON.parse(readFileSync(join(LOCALES_DIR, 'en.json'), 'utf8')) as JsonObject;
const enFlat = flatten(en);

for (const localeFile of ['es.json', 'ca-ES.json', 'it.json']) {
  const target = JSON.parse(readFileSync(join(LOCALES_DIR, localeFile), 'utf8')) as JsonObject;
  const targetFlat = flatten(target);
  let copied = 0;
  for (const [key, value] of enFlat) {
    if (targetFlat.has(key)) continue;
    if (enUsesFlatKey(en, key)) target[key] = value;
    else setNested(target, key.split('.'), value);
    copied += 1;
  }
  writeFileSync(join(LOCALES_DIR, localeFile), `${JSON.stringify(target, null, 2)}\n`, 'utf8');
  console.log(`[${localeFile}] copied ${copied} missing keys`);
}
