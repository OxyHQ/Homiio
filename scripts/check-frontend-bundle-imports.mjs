#!/usr/bin/env node
/**
 * Refuse package-barrel imports that make Metro include every icon family.
 *
 * Metro does not tree-shake the `@expo/vector-icons` root barrel. Importing a
 * single Ionicons glyph through it therefore emits every bundled TTF on web.
 * Direct family subpaths preserve the exact glyph API while keeping unrelated
 * fonts out of the export.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(process.argv[2] ?? new URL('../packages/frontend', import.meta.url).pathname);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set(['.expo', 'dist', 'node_modules']);
const ROOT_VECTOR_ICON_IMPORT = /from\s+['"]@expo\/vector-icons['"]/;

function extension(path) {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (SOURCE_EXTENSIONS.has(extension(path))) files.push(path);
  }
  return files;
}

const violations = [];
for (const file of sourceFiles(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (ROOT_VECTOR_ICON_IMPORT.test(line)) {
      violations.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error(
    'Import icon families through @expo/vector-icons/<Family>; the root barrel bundles every font.\n' +
      violations.join('\n'),
  );
  process.exit(1);
}

console.log('Frontend bundle imports: no @expo/vector-icons root-barrel imports.');
