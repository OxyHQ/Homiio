#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = resolve(process.argv[2] ?? new URL('../packages/frontend/dist', import.meta.url).pathname);
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

const metrics = {
  totalBytes: 0,
  javaScriptGzipBytes: 0,
  fontBytes: 0,
};

for (const file of files(DIST)) {
  const size = statSync(file).size;
  metrics.totalBytes += size;
  if (file.endsWith('.js')) metrics.javaScriptGzipBytes += gzipSync(readFileSync(file)).length;
  if (/\.(?:otf|ttf|woff2?)$/.test(file)) metrics.fontBytes += size;
}

const checks = [
  ['totalBytes', 'maxTotalBytes'],
  ['javaScriptGzipBytes', 'maxJavaScriptGzipBytes'],
  ['fontBytes', 'maxFontBytes'],
];
const failures = checks.filter(([metric, limit]) => metrics[metric] > budget[limit]);

console.log(JSON.stringify({ metrics, budget }, null, 2));
if (failures.length > 0) {
  for (const [metric, limit] of failures) {
    console.error(`${metric} is ${metrics[metric]} bytes; budget ${limit} is ${budget[limit]}.`);
  }
  process.exit(1);
}

console.log('Web export is within its size budgets.');
