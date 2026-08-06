#!/usr/bin/env node

/**
 * Mutation test for the fifteen constraints migration 0002 exists to add.
 *
 * ## Why this is not optional
 *
 * `propertyOfferings.test.ts` and `propertyImages.test.ts` assert that an
 * incoherent row is REFUSED. A test of that shape has a specific failure mode:
 * if the constraint is not there at all, the insert still throws for some other
 * reason — a typo in a column name, a missing fixture, a foreign key — and the
 * test passes while measuring nothing. "Ran and found nothing" and "did not
 * run" read identically.
 *
 * So each constraint is deliberately BROKEN, one at a time, and the run must
 * (a) go red and (b) NAME the constraint in its output. Both halves matter: a
 * red run that does not say which constraint failed is a check whose failure a
 * reader cannot act on, which is why every one of these constraints is written
 * per-offering rather than as one combined CHECK.
 *
 * ## What is mutated, and why it is `CHECK (true or …` rather than a delete
 *
 * The migration SQL, not the schema TypeScript — the jest harness builds each
 * worker's throwaway database by applying `drizzle/*.sql` through the real
 * migrator, so the SQL is what the tests actually run against. Editing the
 * `.ts` would change nothing about the database.
 *
 * A CHECK is neutered by injecting `true or ` immediately after its opening
 * parenthesis, never by deleting it. Two reasons, and the second was found the
 * hard way:
 *
 *  - **Deleting a line produces a SYNTAX ERROR.** Some constraints end in a
 *    comma and the last one does not, so a migration that fails to apply makes
 *    every test in the file red for a reason that has nothing to do with the
 *    constraint — a false kill.
 *  - **Not every CHECK is one line.** The four block-integrity constraints span
 *    five lines each in the emitted DDL. An earlier version of this script
 *    replaced the whole parenthesised expression with `(true)` via a
 *    single-line regex, which matched ZERO times for those four; the
 *    match-count guard below turned that into a loud abort rather than a silent
 *    pass, which is the only reason it was noticed. Injecting after the opening
 *    paren is shape-agnostic: it leaves parenthesis nesting untouched whether
 *    the expression is one line or fifty, and `true or …` short-circuits, so it
 *    neuters the constraint even when the original expression evaluates NULL.
 *
 * ## Restoring
 *
 * IN PLACE, with `writeFileSync` (truncate-and-write, same inode — the `cat
 * pristine > target` form), never a rename. The pristine copy is taken from the
 * file as it exists on disk BEFORE any mutation, not from git: during a
 * mutation test the working tree is precisely not what `git checkout` would
 * restore to, so `git restore` would revert uncommitted work along with the
 * mutation. Every restore is verified by md5 against the pristine digest, and a
 * mismatch is a hard failure rather than a warning.
 *
 * Usage:
 *   bun run --cwd packages/backend test:constraints:mutate
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION = join(BACKEND, 'drizzle', '0002_property.sql');

/**
 * One constraint, the edit that removes its power, the suite that must notice,
 * and the string that failure must contain.
 */
const MUTATIONS = [
  {
    constraint: 'properties_offering_long_term_rent_check',
    suite: '__tests__/db/propertyOfferings.test.ts',
  },
  {
    constraint: 'properties_offering_short_term_rent_check',
    suite: '__tests__/db/propertyOfferings.test.ts',
  },
  {
    constraint: 'properties_offering_sale_check',
    suite: '__tests__/db/propertyOfferings.test.ts',
  },
  {
    constraint: 'properties_offering_exchange_check',
    suite: '__tests__/db/propertyOfferings.test.ts',
  },
  {
    constraint: 'property_images_one_primary_key',
    suite: '__tests__/db/propertyImages.test.ts',
    unique: true,
  },
  // The five vocabularies the enum audit ranks as the entire copy risk. Added
  // after a dry run of this script reported `properties_type_check` as
  // SURVIVED — which is the script doing its job, and is why the list is not
  // just the constraints somebody remembered to test.
  {
    constraint: 'properties_type_check',
    suite: '__tests__/db/propertyVocabularies.test.ts',
  },
  {
    constraint: 'properties_status_check',
    suite: '__tests__/db/propertyVocabularies.test.ts',
  },
  {
    constraint: 'properties_furnished_status_check',
    suite: '__tests__/db/propertyVocabularies.test.ts',
  },
  {
    constraint: 'properties_long_term_rent_currency_check',
    suite: '__tests__/db/propertyVocabularies.test.ts',
  },
  {
    constraint: 'properties_source_check',
    suite: '__tests__/db/propertyVocabularies.test.ts',
  },
  // The four block-INTEGRITY checks, which restore the half of
  // `offeringValidation.ts` that price-null-ness alone cannot see.
  {
    constraint: 'properties_long_term_rent_block_check',
    suite: '__tests__/db/propertyOfferings.test.ts',
  },
  {
    constraint: 'properties_short_term_rent_block_check',
    suite: '__tests__/db/propertyOfferings.test.ts',
  },
  {
    constraint: 'properties_sale_block_check',
    suite: '__tests__/db/propertyOfferings.test.ts',
  },
  {
    constraint: 'properties_exchange_block_check',
    suite: '__tests__/db/propertyOfferings.test.ts',
  },
  // The conditional that replaces the `NOT NULL` a table of external-only
  // listings would have talked us into.
  {
    constraint: 'properties_external_source_url_check',
    suite: '__tests__/db/propertyVocabularies.test.ts',
  },
];

const md5 = (text) => createHash('md5').update(text).digest('hex');

/**
 * Neuter one constraint in `sql`.
 *
 * @throws {Error} When the pattern matches zero times or more than once. A
 *   mutation that silently applied to nothing would make the whole run report
 *   "the test caught it" when the test was never given anything to catch —
 *   which is the exact failure this script exists to detect, one level up.
 */
function mutate(sql, mutation) {
  const pattern = mutation.unique
    ? new RegExp(`^CREATE UNIQUE INDEX "${mutation.constraint}"`, 'gm')
    : new RegExp(`^(\\tCONSTRAINT "${mutation.constraint}" CHECK )\\(`, 'gm');
  const replacement = mutation.unique
    ? `CREATE INDEX "${mutation.constraint}"`
    : '$1(true or ';

  const matches = sql.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(
      `Mutation for ${mutation.constraint} matched ${matches ? matches.length : 0} times in ` +
        `${MIGRATION}; expected exactly 1. The migration changed shape and this script is ` +
        'now measuring nothing.',
    );
  }
  return sql.replace(pattern, replacement);
}

/** Run one jest suite. Returns its exit status and combined output. */
function runSuite(suite) {
  try {
    const output = execFileSync(
      'bunx',
      ['jest', suite, '--runInBand', '--verbose'],
      { cwd: BACKEND, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    return { failed: false, output };
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    return { failed: true, output: `${stdout}\n${stderr}` };
  }
}

const pristine = readFileSync(MIGRATION, 'utf8');
const pristineDigest = md5(pristine);
console.log(`pristine ${MIGRATION}`);
console.log(`md5      ${pristineDigest}\n`);

/** Restore the migration and refuse to continue if it did not come back byte-identical. */
function restore() {
  writeFileSync(MIGRATION, pristine);
  const digest = md5(readFileSync(MIGRATION, 'utf8'));
  if (digest !== pristineDigest) {
    throw new Error(
      `RESTORE FAILED: ${MIGRATION} is ${digest}, expected ${pristineDigest}. ` +
        'Do not commit — the migration on disk is not the one this run started with.',
    );
  }
}

const problems = [];
let checked = 0;

try {
  // The BASELINE, first and on the untouched file. Without it a red run after a
  // mutation proves nothing: the suite could have been red before anyone
  // touched anything, and the mutation would take credit for it.
  for (const suite of [...new Set(MUTATIONS.map((mutation) => mutation.suite))]) {
    const baseline = runSuite(suite);
    if (baseline.failed) {
      problems.push(
        `BASELINE RED: ${suite} already fails on the unmutated migration, so nothing below ` +
          'can be attributed to a mutation.',
      );
      console.error(baseline.output);
    } else {
      console.log(`baseline green: ${suite}`);
    }
  }

  if (problems.length === 0) {
    for (const mutation of MUTATIONS) {
      writeFileSync(MIGRATION, mutate(pristine, mutation));
      const result = runSuite(mutation.suite);
      restore();
      checked += 1;

      if (!result.failed) {
        problems.push(
          `SURVIVED: ${mutation.constraint} was neutered and ${mutation.suite} still passed. ` +
            'The suite is not measuring this constraint.',
        );
        continue;
      }
      if (!result.output.includes(mutation.constraint)) {
        problems.push(
          `UNNAMED: ${mutation.suite} went red for a neutered ${mutation.constraint}, but its ` +
            'output never names the constraint, so a reader cannot tell which one broke.',
        );
        console.error(result.output);
        continue;
      }
      console.log(`killed: ${mutation.constraint} (${mutation.suite})`);
    }
  }
} finally {
  restore();
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`\n${problem}`);
  console.error(`\n${problems.length} problem(s) across ${MUTATIONS.length} mutation(s).`);
  process.exit(1);
}

// Print what ran, not merely that nothing failed: "0 problems" over an empty
// loop reads exactly like a pass.
console.log(`\n${checked} of ${MUTATIONS.length} mutation(s) killed, each naming its constraint.`);
console.log(`${MIGRATION} restored and verified at md5 ${pristineDigest}.`);
