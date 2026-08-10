/**
 * No JSX element carries React Native's FUNCTION-FORM `style` prop.
 *
 * ## The bug it guards
 *
 * NativeWind's css-interop (v4 `react-native-css-interop`, and the v5 preview
 * this app runs) rewrites the `style` prop of every JSX element to merge
 * `className` styles, and it does NOT support `style={({ pressed }) => [...]}`.
 * The function is swallowed and the element renders with **no style at all** —
 * silently, with children still rendering their own styles, which is what makes
 * it look like a spacing bug rather than a dropped prop. `AGENTS.md` carries the
 * rule and the replacement (a static style array plus `onPressIn`/`onPressOut`
 * state); `components/search/SearchSummaryBar.tsx` is the canonical template.
 *
 * ## Why this file exists rather than the documented grep
 *
 * The rule shipped as a command in `AGENTS.md` —
 * `grep -rn "style={({" app components --include=*.tsx` must return ZERO — and a
 * grep is LINE-based, so it cannot tell code from prose. It began returning `1`
 * the moment a component's own doc comment quoted the forbidden form in order to
 * warn about it (`components/location/LocationScopeBar.tsx`). A gate that cries
 * wolf gets switched off by whoever hits it next, and an off gate is worse than
 * the hole it was covering.
 *
 * So the scan strips comments first, through the ONE comment stripper this
 * repository has (`@homiio/shared-types/testing/stripComments`) — `AGENTS.md`
 * records that having two is itself a defect, and the currency and geocoder
 * gates already use this one.
 *
 * ## The anti-vacuity defences, which every scan of this shape needs
 *
 *  - **`git ls-files`, not a directory walk** — build output is excluded for
 *    free rather than by an ignore list that rots, and the file set cannot
 *    disagree with what git tracks. Consequence for anyone mutation-testing
 *    this: an UNSTAGED probe is not in the index and therefore not scanned, so
 *    a planted file must be `git add -f`ed or the mutation measures nothing.
 *  - **A directory pathspec**, never a doubled-star glob ending in an extension:
 *    that form matches only files in a SUBdirectory and silently drops every
 *    top-level one, which reads exactly like a clean result.
 *  - **A vacuity floor** on files scanned. `expect([]).toEqual([])` is what a
 *    broken traversal produces and is indistinguishable from a clean tree.
 *  - **A pinned predicate**, positive AND negative: the positive case fails if
 *    the scan stops matching anything at all, and the negative case is the
 *    comment that caused this file to be written.
 *  - **A tracked-but-unreadable file is a FAILURE, not a skip.** An unread file
 *    is exactly where a reintroduction would hide.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments } from '@homiio/shared-types/testing/stripComments';

/** Repository root — two levels up from `packages/frontend`. */
const REPO_ROOT = join(__dirname, '..', '..', '..');

/** Directory pathspecs, never a doubled-star glob. See the header. */
const SCANNED_PATHSPECS = ['packages/frontend/app', 'packages/frontend/components'];

/**
 * Extensions that must be clean. Affirmative on purpose: a file type arriving
 * tomorrow is not silently exempt, it is simply not yet covered, and adding it
 * here is a visible decision.
 */
const SCANNED_EXTENSIONS = ['.tsx', '.jsx'];

/**
 * The forbidden shape: a `style` prop opening with a function.
 *
 * Whitespace-tolerant between `{` and `(`, because `style={ ({ pressed }) =>`
 * is the same bug written by a different formatter. Deliberately NOT anchored to
 * `pressed`: `({ hovered })`, `({ focused })` and a bare `() =>` are the same
 * swallowed prop, and a pattern naming one of them would pass the others.
 */
const FUNCTION_FORM_STYLE = /style=\{\s*\(/;

/**
 * Sized against the tree at the time of writing (291 files under these two
 * pathspecs) with room to shrink. A number this far below the real count cannot
 * be tripped by ordinary deletion, and a traversal that broke entirely returns
 * zero.
 */
const MINIMUM_SCANNED_FILES = 150;

interface Finding {
  file: string;
  line: number;
  text: string;
}

/** Every CODE line of `source` carrying the function form. Prose cannot match. */
function scanSource(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  stripComments(source)
    .split('\n')
    .forEach((text, index) => {
      if (FUNCTION_FORM_STYLE.test(text)) {
        findings.push({ file, line: index + 1, text: text.trim() });
      }
    });
  return findings;
}

/** Tracked source files under the scanned pathspecs, by repo-relative path. */
function trackedSourceFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '--', ...SCANNED_PATHSPECS], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return output
    .split('\n')
    .filter(Boolean)
    .filter((file) => SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension)));
}

const describeFinding = (finding: Finding): string => `${finding.file}:${finding.line}  ${finding.text}`;

describe('the predicate can tell code from prose', () => {
  it('matches a real function-form style prop', () => {
    // The POSITIVE control. Without it, a scan that stopped matching anything at
    // all would report a clean tree forever.
    expect(scanSource('probe.tsx', '<Pressable style={({ pressed }) => [styles.x]} />')).toHaveLength(1);
  });

  it('matches the other function forms, not just `pressed`', () => {
    // A pattern naming one destructured flag would pass the rest, and every one
    // of these is the same swallowed prop.
    for (const source of [
      '<Pressable style={({ hovered }) => styles.x} />',
      '<Pressable style={({ focused }) => styles.x} />',
      '<Pressable style={() => styles.x} />',
      '<Pressable style={ ({ pressed }) => styles.x } />',
    ]) {
      expect(scanSource('probe.tsx', source)).toHaveLength(1);
    }
  });

  it('does NOT match a doc comment quoting the forbidden form', () => {
    // The NEGATIVE control, and the reason this file replaced a grep: a
    // component warning about the rule in its own header is not a violation of
    // it. This is the exact text at `components/location/LocationScopeBar.tsx`.
    const comment = [
      '/**',
      " * `style={({ pressed }) => [...]}` — the css-interop swallows the function",
      ' * form and the element renders with no style at all.',
      ' */',
      'const x = 1;',
    ].join('\n');

    expect(scanSource('probe.tsx', comment)).toEqual([]);
  });

  it('does NOT match a line comment or a static style array', () => {
    expect(scanSource('probe.tsx', '// style={({ pressed }) => …} is forbidden')).toEqual([]);
    // The SANCTIONED replacement must not be flagged, or the gate would forbid
    // its own fix.
    expect(
      scanSource('probe.tsx', '<Pressable style={[styles.x, pressed && styles.xPressed]} />'),
    ).toEqual([]);
  });
});

describe('no component uses the function-form style prop', () => {
  const files = trackedSourceFiles();

  it('scans enough files that a broken traversal cannot pass as clean', () => {
    expect(files.length).toBeGreaterThanOrEqual(MINIMUM_SCANNED_FILES);
  });

  it('finds no violation, and can read every file it was given', () => {
    const findings: Finding[] = [];
    const unreadable: string[] = [];

    for (const file of files) {
      let source: string;
      try {
        source = readFileSync(join(REPO_ROOT, file), 'utf8');
      } catch {
        // A tracked file the tree does not have is a FAILURE, never a skip: an
        // unread file is exactly where a reintroduction would hide.
        unreadable.push(file);
        continue;
      }
      findings.push(...scanSource(file, source));
    }

    expect(unreadable).toEqual([]);
    // Reported with file, line and the offending text, so whoever hits this gate
    // does not have to go looking for it.
    expect(findings.map(describeFinding)).toEqual([]);
  });
});
