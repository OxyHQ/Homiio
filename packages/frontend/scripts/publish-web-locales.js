#!/usr/bin/env node
/**
 * Copy `locales/*.json` into `public/locales/` so the WEB app can fetch the
 * active language instead of bundling all twelve into its JavaScript.
 *
 * It runs from `metro.config.js`, like `vendor-maplibre-worker.js`, so every
 * Metro process — `expo start`, `expo export` in CI and in deploy-frontends.yml —
 * serves or exports the locale files of the very checkout it is building.
 * `locales/` stays the only source of truth; `public/locales/` is gitignored.
 */
const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.dirname(require.resolve('../package.json'));
const SOURCE_DIR = path.join(FRONTEND_ROOT, 'locales');
const TARGET_DIR = path.join(FRONTEND_ROOT, 'public', 'locales');

function publishWebLocales() {
  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  for (const file of fs.readdirSync(SOURCE_DIR)) {
    if (!file.endsWith('.json')) continue;
    // Parse before copying: a malformed locale must fail the build here, not
    // surface as a language that silently never loads in production.
    const contents = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8');
    JSON.parse(contents);
    fs.writeFileSync(path.join(TARGET_DIR, file), contents);
  }
}

if (require.main === module) publishWebLocales();

module.exports = { publishWebLocales };
