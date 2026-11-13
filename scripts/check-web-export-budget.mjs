#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = resolve(
  process.argv[2] ?? new URL('../packages/frontend/dist', import.meta.url).pathname,
);
const BUDGET_FILE = resolve(
  process.argv[3] ?? new URL('../performance-budgets.json', import.meta.url).pathname,
);
const { frontendWeb: budget } = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

// Bloom's agent-avatar catalogue: each vector payload is its own on-demand chunk holding one
// module, `exports = { encoding: "json", data: "..." }` (Bloom's packed asset format). It is
// fetched only when a gemie's avatar is drawn, never by the first page, so it has its own budget
// and the app's budgets measure everything else.
const AVATAR_PAYLOAD = /^__d\(function\([\w$,]+\)\{[\w$]+\.exports=\{encoding:"json",data:"/;

const firstPage = new Set(
  [...readFileSync(resolve(DIST, 'index.html'), 'utf8').matchAll(/src="\/([^"]+\.js)"/g)].map(
    (match) => match[1],
  ),
);

const metrics = {
  totalBytes: 0,
  javaScriptGzipBytes: 0,
  fontBytes: 0,
  avatarCatalogBytes: 0,
  avatarCatalogGzipBytes: 0,
};
const avatarChunksOnFirstPage = [];

for (const file of files(DIST)) {
  const size = statSync(file).size;
  if (file.endsWith('.js')) {
    const source = readFileSync(file);
    const gzipBytes = gzipSync(source).length;
    if (AVATAR_PAYLOAD.test(source.toString('utf8', 0, 200))) {
      metrics.avatarCatalogBytes += size;
      metrics.avatarCatalogGzipBytes += gzipBytes;
      if (firstPage.has(relative(DIST, file))) avatarChunksOnFirstPage.push(relative(DIST, file));
      continue;
    }
    metrics.javaScriptGzipBytes += gzipBytes;
  }
  metrics.totalBytes += size;
  if (/\.(?:otf|ttf|woff2?)$/.test(file)) metrics.fontBytes += size;
}

const checks = [
  ['totalBytes', 'maxTotalBytes'],
  ['javaScriptGzipBytes', 'maxJavaScriptGzipBytes'],
  ['fontBytes', 'maxFontBytes'],
  ['avatarCatalogBytes', 'maxAvatarCatalogBytes'],
  ['avatarCatalogGzipBytes', 'maxAvatarCatalogGzipBytes'],
];
const failures = checks.filter(([metric, limit]) => metrics[metric] > budget[limit]);

console.log(JSON.stringify({ metrics, budget }, null, 2));
for (const chunk of avatarChunksOnFirstPage) {
  console.error(`${chunk} is an avatar catalogue chunk loaded by the first page.`);
}
for (const [metric, limit] of failures) {
  console.error(`${metric} is ${metrics[metric]} bytes; budget ${limit} is ${budget[limit]}.`);
}
if (failures.length > 0 || avatarChunksOnFirstPage.length > 0) process.exit(1);

console.log('Web export is within its size budgets.');
