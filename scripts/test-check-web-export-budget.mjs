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
const run = () => spawnSync(process.execPath, [CHECK, dist, budgetFile], { encoding: 'utf8' });
const setBudget = (frontendWeb) => writeFileSync(budgetFile, JSON.stringify({ frontendWeb }));
const fail = (message, result) => {
  console.error(`FAIL: ${message}\n${result.stdout}${result.stderr}`);
  process.exit(1);
};
const AVATAR_CHUNK = '__d(function(e,o,a,c,l,r,f){l.exports={encoding:"json",data:"{}"}},1,[]);\n';
const budget = {
  maxTotalBytes: 256,
  maxJavaScriptGzipBytes: 128,
  maxFontBytes: 32,
  maxAvatarCatalogBytes: 128,
  maxAvatarCatalogGzipBytes: 128,
};

writeFileSync(join(dist, 'index.html'), '<script src="/entry.js"></script>\n');
writeFileSync(join(dist, 'entry.js'), 'export const value = 1;\n');
writeFileSync(join(dist, 'icons.ttf'), Buffer.alloc(16));
writeFileSync(join(dist, 'avatar.js'), AVATAR_CHUNK);
setBudget(budget);
const clean = run();
if (clean.status !== 0) fail('in-budget fixture was rejected', clean);
if (!clean.stdout.includes(`"avatarCatalogBytes": ${AVATAR_CHUNK.length}`)) {
  fail('the avatar catalogue chunk was not measured on its own line', clean);
}

setBudget({ ...budget, maxFontBytes: 8 });
const oversized = run();
if (oversized.status !== 1 || !oversized.stderr.includes('fontBytes')) {
  fail('oversized font escaped the budget', oversized);
}

setBudget({ ...budget, maxAvatarCatalogBytes: 8 });
const catalogue = run();
if (catalogue.status !== 1 || !catalogue.stderr.includes('avatarCatalogBytes')) {
  fail('an oversized avatar catalogue escaped its budget', catalogue);
}

setBudget(budget);
writeFileSync(join(dist, 'index.html'), '<script src="/avatar.js"></script>\n');
const eager = run();
if (eager.status !== 1 || !eager.stderr.includes('loaded by the first page')) {
  fail('an avatar catalogue chunk on the first page escaped the gate', eager);
}
console.log('Web-export budget mutations detected.');
