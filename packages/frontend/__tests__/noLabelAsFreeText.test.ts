/**
 * The gate #354 asks for by name: a mutation that keeps the old place's label
 * must FAIL, and must name the file that did it.
 *
 * ## What it forbids, and why a behavioural test is not enough on its own
 *
 * ADR 0002 §4.1: `location` and `text` are independent dimensions, and `q`
 * carries what a person TYPED and nothing else. The bug this closes is one line
 * long and looks like a kindness — send the place's name as free text too, so
 * the search "also matches the city" — and its consequence is the defect the
 * whole epic exists for:
 *
 *     buildSearchParams → { swLat: …Madrid…, q: 'Barcelona' }
 *
 * "Barcelona-matching listings physically inside Madrid" is an honest question
 * with the honest answer zero, and zero renders as "this area is empty". No
 * exception, no type error, no failing request.
 *
 * `searchThisAreaContract.test.ts` pins the BEHAVIOUR for the one path that
 * exists today. This file pins the RULE, everywhere, including the paths
 * somebody adds next week — and it is the half that survives a refactor,
 * because a behavioural test only covers the call sites it happens to know
 * about.
 *
 * ## Design notes, because every failure mode of a scan like this is silent
 *
 * Follows `noHardcodedCurrency.test.ts`, this repo's reference for the shape:
 * `git ls-files` enumeration (build output excluded for free, and the file set
 * cannot disagree with what git tracks), a directory pathspec rather than a
 * doubled-star glob ending in an extension (that form matches only files in a
 * SUBdirectory and drops every top-level one, which reads exactly like a clean
 * result), an AFFIRMATIVE extension list, a vacuity floor on files scanned, and
 * a pinned predicate case with a negative control beside it.
 *
 * Note for anyone mutation-testing it: enumeration is the git INDEX, so an
 * UNSTAGED probe file is not in the scan and a mutation planted that way
 * measures nothing and "passes". `git add -f` the probe first.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments } from '@homiio/shared-types/testing/stripComments';

const REPO_ROOT = join(__dirname, '..', '..', '..');

/**
 * Directory pathspecs. Every package that can build a search request: the
 * frontend assembles it, the backend reads it, and shared-types holds the
 * contract that says the two dimensions are separate.
 */
const SCANNED_PACKAGES = ['packages/frontend/', 'packages/backend/', 'packages/shared-types/'];

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Fewer files than this means the traversal broke, not that the tree is clean. */
const MINIMUM_FILES_SCANNED = 800;

/**
 * The expressions that produce a PLACE's name.
 *
 * `label` covers `selection.label.primary` and every destructured form of it;
 * the two helpers are the app's own label functions. `shortLabel` is here
 * because it was the second half of the original bug — the old selection kept
 * both — and its absence from today's types is not a reason to leave the door
 * open.
 */
const LABEL_SOURCES = ['label', 'shortLabel', 'selectionLabel', 'locationDisplayLabel'];

const LABEL_ALTERNATION = LABEL_SOURCES.join('|');

/**
 * `queryText: <anything mentioning a label>` — the store/query dimension.
 *
 * Case-sensitive on purpose: `\blabel\b` does not match `priceLabel`,
 * `accessibilityLabel` or `stillShowingLabel`, because the capital L is a word
 * character and the boundary never lands there. That is what keeps this gate
 * from crying wolf on the dozens of legitimate `*Label` identifiers in the app.
 */
const QUERY_TEXT_FROM_LABEL = new RegExp(
  `\\bqueryText\\s*[:=]\\s*[^,;\\n]*\\b(?:${LABEL_ALTERNATION})\\b`,
  'u',
);

/** `setQueryText(<anything mentioning a label>)` — the store's only text writer. */
const SET_QUERY_TEXT_FROM_LABEL = new RegExp(
  `setQueryText\\(\\s*[^)\\n]*\\b(?:${LABEL_ALTERNATION})\\b`,
  'u',
);

/** `q: <label>` / `params.q = <label>` — the request parameter itself. */
const Q_PARAM_FROM_LABEL = new RegExp(
  `\\bq\\s*[:=]\\s*[^,;\\n]*\\b(?:${LABEL_ALTERNATION})\\b`,
  'u',
);

/**
 * `{ ...mapBoundsSelection(box), label: … }` — the other half of the same bug,
 * and the half that survives every rule above.
 *
 * `mapBoundsSelection` builds a COMPLETE `map_bounds` selection whose label is
 * generated on purpose, and the request builder never sends a label, so keeping
 * the old city's name here changes no parameter at all — it changes the
 * HEADING. The map shows Madrid, the list is Madrid's, and the words above them
 * say Barcelona. That is invariant 6 of #354 and it is invisible to any test
 * that asserts on a request.
 *
 * A spread is the only way to reach it: the store's `commitLocation` takes a
 * whole selection and there is no action that takes less, so forbidding the
 * spread closes the door rather than asking people to remember.
 */
const SPREAD_MAP_BOUNDS_SELECTION = /\.\.\.\s*mapBoundsSelection\s*\(/u;

interface Finding {
  file: string;
  line: number;
  text: string;
  rule: string;
}

function scanSource(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  stripComments(source)
    .split('\n')
    .forEach((text, index) => {
      const rules: string[] = [];
      if (QUERY_TEXT_FROM_LABEL.test(text)) rules.push("a place label written into `queryText`");
      if (SET_QUERY_TEXT_FROM_LABEL.test(text)) rules.push('a place label passed to `setQueryText`');
      if (Q_PARAM_FROM_LABEL.test(text)) rules.push('a place label sent as the `q` request param');
      if (SPREAD_MAP_BOUNDS_SELECTION.test(text)) {
        rules.push('a map-area selection assembled by spreading, which can keep the old label');
      }
      for (const rule of rules) {
        findings.push({ file, line: index + 1, text: text.trim(), rule });
      }
    });
  return findings;
}

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
    .filter((file) => !file.endsWith('__tests__/noLabelAsFreeText.test.ts'));
}

describe('a place label is never free text', () => {
  const files = trackedSourceFiles();

  it('scans enough files that a broken traversal cannot pass as clean', () => {
    // `expect([]).toEqual([])` is exactly what a broken `git ls-files` produces.
    expect(files.length).toBeGreaterThan(MINIMUM_FILES_SCANNED);
  });

  it('recognises every shape the old bug was written in', () => {
    // The pinned predicate. If these stop matching, every assertion below has
    // quietly become vacuous — which is the state this gate exists to prevent
    // in the code it is watching.
    const probe = [
      "const next = { ...query, queryText: query.location.label.primary };",
      "store.setQueryText(selectionLabel(selection)?.primary ?? null);",
      "if (query.location) params.q = locationDisplayLabel(query.location, t);",
      "const params = { q: selection.shortLabel, swLat: box.south };",
      "onCommitLocation({ ...mapBoundsSelection(bounds), label: query.location.label });",
    ].join('\n');

    expect(scanSource('probe.ts', probe).map((finding) => finding.rule).sort()).toEqual([
      'a map-area selection assembled by spreading, which can keep the old label',
      'a place label passed to `setQueryText`',
      'a place label sent as the `q` request param',
      'a place label sent as the `q` request param',
      'a place label written into `queryText`',
    ]);
  });

  it('does NOT flag the correct forms, or it gets switched off by whoever hits it', () => {
    expect(
      scanSource(
        'probe.tsx',
        [
          // The correct assignment: free text carries free text.
          'if (query.queryText) params.q = query.queryText;',
          'const next = { ...query, queryText: text.trim() || null };',
          'store.setQueryText(draftText);',
          // A place label rendered as a LABEL is the whole point of having one.
          'const heading = locationDisplayLabel(query.location, t);',
          'const name = savedSearchName(selection);',
          // The dozens of legitimate `*Label` identifiers in the app.
          'const priceLabel = formatMoney(amount, currency, locale);',
          'accessibilityLabel={t("search.actions.searchArea")}',
          'const stillShowingLabel = t("search.area.stillShowing", { place });',
          // A single-letter `q` that is a query builder, not the search param.
          'const q = sql`${properties.status} = ${status}`;',
          // The correct call: the selection is committed whole, not spread.
          'onCommitLocation(mapBoundsSelection(pendingViewport));',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('finds no place label reaching the free-text dimension', () => {
    const findings: Finding[] = [];
    const unreadable: string[] = [];

    for (const file of files) {
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
