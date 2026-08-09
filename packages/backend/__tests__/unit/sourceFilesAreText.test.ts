/**
 * Every tracked source file is TEXT, not binary — repository-wide.
 *
 * ## The hole this closes, which passes every other gate by construction
 *
 * A single NUL byte makes git classify a file as binary, and a binary file has
 * **no diff**: `git show`, `git log -p` and every pull-request review print
 * `Bin 0 -> N bytes` where the code should be. Nobody reviewing that pull
 * request can see a line of it.
 *
 * Nothing else notices. `packages/backend/db/backfill/rowAudit.ts` shipped in
 * PR #293 carrying two of them, inside a template literal used as a map key:
 * TypeScript compiled it, eslint passed it, its own 36 tests passed, and every
 * CI job was green. The only thing that ever said so was `git show --stat`
 * after the merge, which nobody has a reason to run.
 *
 * So this is a REVIEWABILITY property, not a correctness one, and it cannot be
 * caught by a tool that reads the file as text — every one of them decodes the
 * NUL happily. It has to be asserted on the bytes.
 *
 * ## Repository-wide, deliberately
 *
 * This started scoped to `packages/backend/db/`, where the defect happened. That
 * is the wrong scope: the hazard belongs to the REPOSITORY (git's classification
 * and what a reviewer can see), not to any package, and a file written anywhere
 * by anyone has the same problem. Living in the backend suite is a compromise —
 * it is the suite CI always runs — and it costs about 10 MB of reads.
 *
 * `git ls-files` rather than a directory walk: it is the exact set git will
 * classify, so the check cannot disagree with the thing it is checking, and
 * `node_modules`, `dist` and every build output are excluded for free rather
 * than by a hand-maintained ignore list that would rot.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repository root — two levels above this package. */
const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');

/**
 * Extensions a human reads in a diff.
 *
 * Not "everything git tracks": fonts, images and lockfile binaries are
 * legitimately binary, and listing what must be TEXT is the affirmative form —
 * a new binary asset type cannot silently widen it.
 */
const TEXT_EXTENSIONS = [
  '*.ts',
  '*.tsx',
  '*.js',
  '*.jsx',
  '*.mjs',
  '*.cjs',
  '*.json',
  '*.md',
  '*.yml',
  '*.yaml',
  '*.sql',
];

/**
 * Floor on the number of files scanned.
 *
 * A traversal that silently stopped matching — a moved root, a renamed
 * extension, a `git ls-files` that returned nothing because the working
 * directory was wrong — would otherwise report "no offenders" forever, which is
 * the same class of failure this file exists to catch. Measured at 1,212 on
 * 2026-08-09; set well below it so ordinary deletion cannot trip it.
 */
const MINIMUM_FILES_SCANNED = 800;

function trackedTextFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '--', ...TEXT_EXTENSIONS], {
    cwd: REPOSITORY_ROOT,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
  return output
    .toString('utf8')
    .split('\0')
    .filter((path) => path.length > 0);
}

describe('tracked source files are text, not binary', () => {
  it('contains no NUL byte, so every file has a reviewable diff', () => {
    const files = trackedTextFiles();
    expect(files.length).toBeGreaterThan(MINIMUM_FILES_SCANNED);

    const offenders = files.filter((path) =>
      readFileSync(join(REPOSITORY_ROOT, path)).includes(0),
    );
    expect(offenders).toEqual([]);
  });

  it('can actually detect one — the check is not vacuous', () => {
    // The assertion above is `[] === []` on a clean tree, which is exactly what
    // a broken scan also produces. This pins the predicate itself against a
    // buffer holding the byte, so "no offenders" means the scan looked.
    expect(Buffer.from('const key = `a\0b`;', 'utf8').includes(0)).toBe(true);
    expect(Buffer.from('const key = `a b`;', 'utf8').includes(0)).toBe(false);
  });
});
