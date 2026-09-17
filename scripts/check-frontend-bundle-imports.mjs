#!/usr/bin/env node
/**
 * Refuse package-barrel imports that make Metro bundle a whole package.
 *
 * Metro does not tree-shake, so a root barrel pulls in everything behind it:
 *
 * - `@expo/vector-icons` emits every bundled icon font on web for one glyph.
 *   Direct family subpaths keep the glyph API and leave the other fonts out.
 * - `@oxy.so/bloom` drags every Bloom family into the graph, including ones
 *   with optional peers, where an unmet peer is a build failure rather than
 *   dead weight. Import `@oxy.so/bloom/<family>`.
 *
 * The check is line-based on import/require/mock specifiers. Comment lines are
 * skipped, so a doc comment that quotes the forbidden form does not trip it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(process.argv[2] ?? new URL('../packages/frontend', import.meta.url).pathname);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set(['.expo', 'dist', 'node_modules']);

/**
 * `from '<pkg>'`, `import '<pkg>'`, `require('<pkg>')`, `import('<pkg>')`,
 * `jest.mock('<pkg>')` — the exact root specifier, never a subpath.
 */
function rootSpecifier(pkg) {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(
    `(?:\\bfrom\\s+|\\bimport\\s+|\\b(?:require|import|mock|requireActual)\\(\\s*)['"]${escaped}['"]`,
  );
}

const BARRELS = [
  {
    pattern: rootSpecifier('@expo/vector-icons'),
    message:
      'Import icon families through @expo/vector-icons/<Family>; the root barrel bundles every font.',
  },
  {
    pattern: rootSpecifier('@oxy.so/bloom'),
    message:
      "Import Bloom through its family subpath (@oxy.so/bloom/<family>); the root '@oxy.so/bloom' barrel bundles every family.",
  },
];

function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

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

const violations = BARRELS.map(() => []);
for (const file of sourceFiles(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    BARRELS.forEach(({ pattern }, barrel) => {
      if (pattern.test(line)) {
        violations[barrel].push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  });
}

let failed = false;
BARRELS.forEach(({ message }, barrel) => {
  if (violations[barrel].length === 0) return;
  failed = true;
  console.error(`${message}\n${violations[barrel].join('\n')}`);
});
if (failed) process.exit(1);

console.log('Frontend bundle imports: no @expo/vector-icons or @oxy.so/bloom root-barrel imports.');
