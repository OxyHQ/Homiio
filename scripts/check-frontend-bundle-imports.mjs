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
 * - `@oxy.so/services` root barrel: it registers every account screen at
 *   import, so one import anywhere puts all of them (and the Bloom parts they
 *   draw) in the web entry chunk. Import `@oxy.so/services/ui/client`, the lean
 *   entry; `OxyProvider` loads the screens on its own. In a component, the
 *   account dialog opens through `useOxy().openAccountDialog`.
 * - `@homiio/shared-types` root at runtime: import values from their source
 *   module, leaving the unrelated server contracts out of the Metro graph.
 *   Use declaration-level `import type` or `export type` for the root: a
 *   mixed import containing only `type` specifiers can retain the barrel.
 *
 * The icon and Oxy checks are line-based on import/require/mock specifiers.
 * The shared-types check parses declarations to distinguish type-only imports.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';

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
    pattern: rootSpecifier('@oxy.so/services'),
    message:
      "Import Oxy services through '@oxy.so/services/ui/client'; the root '@oxy.so/services' barrel registers every account screen in the startup bundle.",
  },
  {
    // Any non-English locale file, by alias or relative path. Web fetches the
    // active locale from public/locales/, so one static import puts that whole
    // language back into every web page's JavaScript.
    pattern: new RegExp(
      `${SPECIFIER_PREFIX}['"](?:@/|(?:\\.\\.?/)+)(?:[^'"]*/)?locales/(?!en\\.json['"])[^'"/]+\\.json['"]`,
    ),
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
const sharedTypesViolations = [];
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
  const relativeFile = relative(ROOT, file);
  if (relativeFile.startsWith('__tests__/') || /\.(test|spec)\.[jt]sx?$/.test(relativeFile)) {
    continue;
  }
  const source = ts.createSourceFile(file, lines.join('\n'), ts.ScriptTarget.Latest, true);
  function checkSharedTypes(node) {
    let specifier;
    let typeOnly = false;
    if (ts.isImportDeclaration(node)) {
      specifier = node.moduleSpecifier;
      typeOnly = node.importClause?.isTypeOnly === true;
    } else if (ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
      typeOnly = node.isTypeOnly;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      specifier = node.arguments[0];
    }
    if (
      specifier &&
      ts.isStringLiteral(specifier) &&
      specifier.text === '@homiio/shared-types' &&
      !typeOnly
    ) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      sharedTypesViolations.push(`${relativeFile}:${position.line + 1}`);
    }
    ts.forEachChild(node, checkSharedTypes);
  }
  checkSharedTypes(source);
}

let failed = false;
BARRELS.forEach(({ message }, barrel) => {
  if (violations[barrel].length === 0) return;
  failed = true;
  console.error(`${message}\n${violations[barrel].join('\n')}`);
});
if (sharedTypesViolations.length > 0) {
  failed = true;
  console.error(
    'Import runtime values from @homiio/shared-types/<module>; use import type or export type for the root barrel.\n' +
      sharedTypesViolations.join('\n'),
  );
}
if (failed) process.exit(1);

console.log(
  'Frontend bundle imports: no forbidden icon, root-barrel, or bundled non-English locale imports.',
);
