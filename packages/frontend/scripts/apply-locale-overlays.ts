/**
 * Apply locale overlay files onto locale bundles (flat or nested keys).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = join(import.meta.dir, '..', 'locales');
const OVERLAY_DIR = join(import.meta.dir, 'overlays');
const TARGETS = ['es', 'ca-ES', 'it'] as const;

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  cursor[parts[parts.length - 1]] = value;
}

function applyOverlayValue(target: JsonObject, key: string, value: unknown): void {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    target[key] = value;
    return;
  }
  setNested(target, key.split('.'), value);
}

function loadJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonObject;
}

for (const locale of TARGETS) {
  const overlayPath = join(OVERLAY_DIR, `${locale}.json`);
  if (!existsSync(overlayPath)) {
    console.log(`[${locale}] no overlay file, skipping`);
    continue;
  }
  const targetFile = join(LOCALES_DIR, `${locale}.json`);
  const target = loadJson(targetFile);
  const overlay = loadJson(overlayPath) as Record<string, unknown>;
  let applied = 0;
  for (const [key, translation] of Object.entries(overlay)) {
    if (translation === undefined || translation === null) continue;
    applyOverlayValue(target, key, translation);
    applied += 1;
  }
  writeFileSync(targetFile, `${JSON.stringify(target, null, 2)}\n`, 'utf8');
  console.log(`[${locale}] applied ${applied} overlay translations`);
}
