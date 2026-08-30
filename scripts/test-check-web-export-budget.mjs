#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CHECK = new URL('./check-web-export-budget.mjs', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'homiio-web-budget-'));
const dist = join(work, 'dist');
const budgetFile = join(work, 'budgets.json');
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
mkdirSync(dist);

function setBudget(frontendWeb) {
  writeFileSync(budgetFile, JSON.stringify({ frontendWeb }));
}

function run() {
  return spawnSync(process.execPath, [CHECK, dist, budgetFile], { encoding: 'utf8' });
}

writeFileSync(join(dist, 'entry.js'), 'export const value = 1;\n');
writeFileSync(join(dist, 'icons.ttf'), Buffer.alloc(16));
setBudget({ maxTotalBytes: 128, maxJavaScriptGzipBytes: 128, maxFontBytes: 32 });
const clean = run();
if (clean.status !== 0) {
  console.error(`FAIL: in-budget fixture was rejected\n${clean.stdout}${clean.stderr}`);
  process.exit(1);
}

setBudget({ maxTotalBytes: 128, maxJavaScriptGzipBytes: 128, maxFontBytes: 8 });
const oversized = run();
if (oversized.status !== 1 || !oversized.stderr.includes('fontBytes')) {
  console.error(`FAIL: oversized font escaped the budget\n${oversized.stdout}${oversized.stderr}`);
  process.exit(1);
}

console.log('Web-export budget mutations detected.');
