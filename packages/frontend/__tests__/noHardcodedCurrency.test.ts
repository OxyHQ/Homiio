/**
 * The gate issue #357 asks for: a mutation that reintroduces `€${amount}` in the
 * map markers — or anywhere else that renders a figure — must fail a test.
 *
 * It scans the source of all three TypeScript packages for the two shapes the
 * census found, both of which look correct and are not:
 *
 *  1. **A currency glyph glued to an interpolated value.** `€${amount}` states a
 *     currency the listing may not be in; it was on every map marker in the
 *     catalogue. The euro sign is not special here — `$`, `£`, `zł` and the rest
 *     are all wrong the same way.
 *  2. **A locale-less `toLocaleString()` / `toLocaleDateString()` /
 *     `toLocaleTimeString()`.** These format in the RUNTIME's locale — the
 *     device's, or on the backend the server's — which is unrelated to the
 *     language the reader chose in Homiio. It reads as "localized" and is not.
 *
 * DESIGN NOTES, because the failure modes of a scan like this are all silent:
 *
 *  - **Enumeration is `git ls-files`**, not a directory walk: build output is
 *    excluded for free rather than by an ignore list that rots, and the file set
 *    cannot disagree with what git tracks. A tracked file missing from the
 *    working tree is recorded as a FAILURE rather than skipped — an unreadable
 *    file is exactly where a reintroduction would hide.
 *  - **An AFFIRMATIVE extension list**, so a new file type cannot silently widen
 *    the exemption by not being on a denylist.
 *  - **A vacuity floor** on the number of files scanned. `expect([]).toEqual([])`
 *    is what a BROKEN traversal produces, and it is indistinguishable from a
 *    clean tree without one.
 *  - **A pinned predicate case**, so a scan that stopped matching anything at all
 *    fails instead of passing.
 *  - **Comments and this file are stripped/excluded.** Several modules explain
 *    the bug they fixed by quoting it (`what `€${amount}` did`), and a comment
 *    renders to nobody. Stripping them is the same call
 *    `__tests__/unit/mongoUnreachable.test.ts` makes in the backend, for the
 *    same reason — and both now make it through the SAME implementation,
 *    `@homiio/shared-types/testing/stripComments`. The two regexes that used to
 *    sit here truncated a line at the `//` of a URL and let a `/*` mentioned
 *    inside a `//` comment open a block, which blanked real code and made this
 *    gate report a clean tree over 1,047 lines of it, across 128 files
 *    (measured 2026-08-10 against this gate's own scanned set). See
 *    `__tests__/stripComments.test.ts`, which pins both regressions.
 *
 * It lives in the FRONTEND suite because that CI job needs no database, and it
 * scans all three packages from the repository root; `shared-types` has no
 * runner of its own and the backend's needs Postgres.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments } from '@homiio/shared-types/testing/stripComments';

/** Repository root — two levels up from `packages/frontend`. */
const REPO_ROOT = join(__dirname, '..', '..', '..');

/** Packages whose source this gate covers. */
const SCANNED_PACKAGES = ['packages/frontend', 'packages/backend', 'packages/shared-types'];

/**
 * Extensions that must be clean. Affirmative on purpose: a `.vue` or `.svelte`
 * arriving tomorrow is not silently exempt, it is simply not yet covered, and
 * adding it here is a visible decision.
 */
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Files allowed to hold a currency glyph or a locale-less `toLocaleString`.
 *
 * Each entry must be justified in the comment beside it. Keeping this list
 * SHRINKING is the point; an entry added without a reason is the failure mode
 * this whole gate exists to prevent, one level up.
 */
const ALLOWED: ReadonlyArray<{ path: string; why: string }> = [
  {
    // The currency CATALOGUE: rows that name currencies for the settings picker
    // (`{ code: 'EUR', symbol: '€', flag: '🇪🇺' }`). It formats nothing.
    path: 'packages/frontend/utils/currency.ts',
    why: 'currency catalogue rows, not a formatted amount',
  },
  {
    // The same catalogue, abbreviated, in the Zustand store's initial state.
    path: 'packages/frontend/store/currencyStore.ts',
    why: 'currency catalogue rows in the store default',
  },
  {
    // The one place allowed to hold a bare `$` for the picker's unknown-code
    // placeholder row.
    path: 'packages/frontend/hooks/useCurrency.ts',
    why: 'placeholder row for a currency code the catalogue does not know',
  },
  {
    // Deliberately locale-INDEPENDENT: the value is an `HH:MM` key matched
    // against the time-slot list, never rendered. The file says so at the line.
    path: 'packages/frontend/app/properties/[id]/book-viewing.tsx',
    why: 'HH:MM slot key, not a display string (comment at the call site)',
  },
  {
    // PERSISTED at schedule-generation time, when no reader and therefore no
    // locale exists. Localising it is a schema change; the file says so.
    path: 'packages/backend/db/leases/paymentSchedule.ts',
    why: 'persisted payment description, no reader locale exists yet',
  },
];

/** Fewer files than this means the traversal broke, not that the tree is clean. */
const MINIMUM_FILES_SCANNED = 700;

/**
 * Currency glyphs that must never be glued to an interpolated value.
 *
 * Every symbol `LISTING_CURRENCIES` can produce, plus the ones a careless author
 * reaches for. Not exhaustive over ISO 4217 and does not need to be: the shapes
 * below are what people actually write.
 */
const CURRENCY_GLYPHS = ['€', '£', '¥', '₹', '₺', '₽', 'zł', 'Kč', 'lei'];

/** Escape a literal for use inside a `RegExp` alternation. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** `€${amount}` / `€{amount}` — a glyph glued to an interpolated value. */
const GLYPH_BEFORE_VALUE = new RegExp(
  `(?:${CURRENCY_GLYPHS.map(escapeForRegExp).join('|')})\\s*\\$?\\{`,
  'u',
);

/** `${amount}€` — a glyph glued to the other side of one. */
const VALUE_BEFORE_GLYPH = new RegExp(
  `\\}\\s*(?:${CURRENCY_GLYPHS.map(escapeForRegExp).join('|')})`,
  'u',
);

/**
 * The dollar sign needs its own narrow rules, because a bare `${` IS ordinary
 * template interpolation and matching it would flag most of the codebase.
 *
 *  - `` `$${amount}` `` — unambiguous anywhere: a literal `$` before an
 *    interpolation.
 *  - `<Text>${amount}</Text>` — a `$` directly after a JSX close bracket. Only
 *    checked in `.tsx`, and only with NO space between, because both loosenings
 *    were measured to cry wolf: a space matches SQL (`<> ${status}`,
 *    `secs => ${n}`), and allowing `.ts` matches HTML template strings
 *    (`<style>${MARKER_STYLES}</style>`, `<PROPERTIES_HINTS>${json}`). Thirty
 *    such false positives came out of one run, which is how a gate ends up
 *    switched off by whoever hits it next.
 *
 * KNOWN GAP, stated rather than papered over: a `$` on its own indented line of
 * JSX text (`\n  ${amount}\n`) is INDISTINGUISHABLE from a multi-line template
 * literal's interpolation without parsing the file, so this gate does not try.
 * Those sites were migrated by hand (`PropertyPreviewWidget`).
 */
const DOLLAR_IN_TEMPLATE = /\$\$\{/u;
const DOLLAR_AFTER_JSX_TAG = />\$\{/u;

/** `toLocaleString()` / `toLocaleDateString()` / `toLocaleTimeString()` with no locale. */
const LOCALELESS_TO_LOCALE = /\.toLocale(?:String|DateString|TimeString)\(\s*\)/u;

/** One offending line, reported with enough context to act on. */
interface Finding {
  file: string;
  line: number;
  text: string;
  rule: string;
}

/** Every offending line in `source`. */
function scanSource(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  stripComments(source)
    .split('\n')
    .forEach((text, index) => {
      const rules: string[] = [];
      if (GLYPH_BEFORE_VALUE.test(text)) rules.push('currency glyph before an interpolated value');
      if (VALUE_BEFORE_GLYPH.test(text)) rules.push('currency glyph after an interpolated value');
      const jsx = file.endsWith('.tsx') || file.endsWith('.jsx');
      if (DOLLAR_IN_TEMPLATE.test(text) || (jsx && DOLLAR_AFTER_JSX_TAG.test(text))) {
        rules.push('dollar sign before an interpolated value');
      }
      if (LOCALELESS_TO_LOCALE.test(text)) rules.push('toLocale*() with no locale argument');
      for (const rule of rules) {
        findings.push({ file, line: index + 1, text: text.trim(), rule });
      }
    });
  return findings;
}

/** Tracked source files in the scanned packages, by repo-relative path. */
function trackedSourceFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '--', ...SCANNED_PACKAGES], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return output
    .split('\n')
    .filter(Boolean)
    .filter((file) => SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension)))
    // This file quotes the very patterns it forbids, so it cannot scan itself.
    .filter((file) => !file.endsWith('__tests__/noHardcodedCurrency.test.ts'));
}

describe('no hardcoded currency or implicit locale in rendered text', () => {
  const files = trackedSourceFiles();
  const allowed = new Set(ALLOWED.map((entry) => entry.path));

  it('scans enough files that a broken traversal cannot pass as clean', () => {
    // `expect([]).toEqual([])` is exactly what a broken `git ls-files` produces.
    expect(files.length).toBeGreaterThan(MINIMUM_FILES_SCANNED);
  });

  it('can still recognise the shapes it forbids', () => {
    // A pinned predicate case: if this stops matching, every other assertion in
    // this file has quietly become vacuous.
    const marker = [
      'const label = `€${Math.round(amount).toLocaleString()}`;',
      'const other = `${amount}€`;',
      'const dollars = `$${amount}`;',
      '<Text>${amount}</Text>',
      'const when = new Date().toLocaleDateString();',
    ].join('\n');
    const found = scanSource('probe.tsx', marker);
    expect(found.map((finding) => finding.rule).sort()).toEqual([
      'currency glyph after an interpolated value',
      'currency glyph before an interpolated value',
      'dollar sign before an interpolated value',
      'dollar sign before an interpolated value',
      // Twice: the marker's first line carries BOTH a glyph and a locale-less
      // call, and one line may break more than one rule.
      'toLocale*() with no locale argument',
      'toLocale*() with no locale argument',
    ]);

    // And the correct forms must NOT match, or the gate cries wolf and gets
    // switched off by whoever hits it next. Ordinary template interpolation is
    // the case that matters most: it is on nearly every line of the codebase.
    expect(
      scanSource(
        'probe.ts',
        [
          'const label = formatMoney(amount, currency, locale);',
          "const when = formatDate(value, locale, 'UTC');",
          "const legacy = value.toLocaleDateString('en-GB', { hour12: false });",
          'const title = `${city}, ${country}`;',
          'logger.error(`Failed for ${key}`, error);',
          // SQL and HTML templates, the two shapes a looser `>${` rule flagged.
          'const q = sql`${properties.status} <> ${status}`;',
          'const doc = `<style>${MARKER_STYLES}</style>`;',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('every allow-list entry names a file that is actually scanned', () => {
    // An entry left behind after its file was deleted or renamed is a stranded
    // exemption nobody will notice; make it fail here instead.
    for (const entry of ALLOWED) {
      expect(files).toContain(entry.path);
    }
  });

  it('finds no hardcoded currency or locale-less formatting outside the allow-list', () => {
    const findings: Finding[] = [];
    const unreadable: string[] = [];

    for (const file of files) {
      if (allowed.has(file)) continue;
      let source: string;
      try {
        source = readFileSync(join(REPO_ROOT, file), 'utf8');
      } catch {
        // Tracked but absent from the working tree. Recorded as a failure
        // rather than skipped: an unread file is where a reintroduction hides.
        unreadable.push(file);
        continue;
      }
      findings.push(...scanSource(file, source));
    }

    expect(unreadable).toEqual([]);
    expect(
      findings.map((finding) => `${finding.file}:${finding.line}  [${finding.rule}]  ${finding.text}`),
    ).toEqual([]);
  });
});
