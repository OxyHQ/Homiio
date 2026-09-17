#!/usr/bin/env node
/**
 * Refuse frontend imports that bloat the web bundle or bypass the icon system.
 *
 * - `@expo/vector-icons` and `lucide-react-native`, by ANY specifier (root or
 *   subpath): app icons are Bloom's Remix components from
 *   `@oxy.so/bloom/icons`. One Ionicons glyph ships a ~390 KB font on web, and
 *   a glyph NAME string is not type-checked against a component set.
 *   (`@expo/vector-icons` stays installed only as `@oxy.so/services`' required
 *   peer; app code must not import it.)
 * - `@oxy.so/bloom` root barrel: Metro does not tree-shake, so it drags every
 *   Bloom family into the graph, including ones with optional peers, where an
 *   unmet peer is a build failure rather than dead weight. Import
 *   `@oxy.so/bloom/<family>`.
 *
 * The check is line-based on import/require/mock specifiers. Comment lines are
 * skipped, so a doc comment that quotes the forbidden form does not trip it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(process.argv[2] ?? new URL('../packages/frontend', import.meta.url).pathname);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set(['.expo', 'dist', 'node_modules']);

const SPECIFIER_PREFIX =
  '(?:\\bfrom\\s+|\\bimport\\s+|\\b(?:require|import|mock|requireActual)\\(\\s*)';

function escapeRegExp(pkg) {
  return pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * `from '<pkg>'`, `import '<pkg>'`, `require('<pkg>')`, `import('<pkg>')`,
 * `jest.mock('<pkg>')` — the exact root specifier, never a subpath.
 */
function rootSpecifier(pkg) {
  return new RegExp(`${SPECIFIER_PREFIX}['"]${escapeRegExp(pkg)}['"]`);
}

/** The same call forms, matching the package root AND every subpath. */
function anySpecifier(pkg) {
  return new RegExp(`${SPECIFIER_PREFIX}['"]${escapeRegExp(pkg)}(?:/[^'"]*)?['"]`);
}

const BARRELS = [
  {
    pattern: anySpecifier('@expo/vector-icons'),
    message:
      'Do not import @expo/vector-icons in app code; use a Remix icon component from @oxy.so/bloom/icons.',
  },
  {
    pattern: anySpecifier('lucide-react-native'),
    message:
      'Do not import lucide-react-native in app code; use a Remix icon component from @oxy.so/bloom/icons.',
  },
  {
    pattern: rootSpecifier('@oxy.so/bloom'),
    message:
      "Import Bloom through its family subpath (@oxy.so/bloom/<family>); the root '@oxy.so/bloom' barrel bundles every family.",
  },
  {
    // Any non-English locale file, by alias or relative path. Web fetches the
    // active locale from public/locales/, so one static import puts that whole
    // language back into every web page's JavaScript.
    pattern: new RegExp(`${SPECIFIER_PREFIX}['"](?:@/|(?:\\.\\.?/)+)(?:[^'"]*/)?locales/(?!en\\.json['"])[^'"/]+\\.json['"]`),
    exempt: (file) => file === 'utils/localeResources.ts' || file.startsWith('__tests__/'),
    message:
      'Do not import a non-English locale JSON in app code; switch languages with setStoredLanguage (utils/languagePreference.ts), which loads it on demand.',
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
    BARRELS.forEach(({ pattern, exempt }, barrel) => {
      if (exempt?.(relative(ROOT, file))) return;
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

console.log(
  'Frontend bundle imports: no @expo/vector-icons, lucide-react-native, @oxy.so/bloom root-barrel or bundled non-English locale imports.',
);
