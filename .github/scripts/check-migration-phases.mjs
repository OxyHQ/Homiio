#!/usr/bin/env bun

// Every Postgres migration must declare which side of a deploy it belongs on.
//
//   -- oxy:deploy-phase=pre    applied BEFORE the new image rolls out
//   -- oxy:deploy-phase=post   applied AFTER the new image is live
//
// THERE IS NO DEFAULT, and that is the point. A migration with no marker, with
// two, or with an unrecognised value is a hard failure here AND at migration
// time. A default would quietly pick a side for a migration whose author never
// considered the question — which is exactly the incident that put the marker
// system in `@oxyhq/db/migrate` in the first place: an additive migration and
// the code that read its new column shipped together, the image reached
// production and the column did not, and every request 500'd until somebody
// dispatched the migration by hand.
//
// This gate imports the REAL marker reader from `@oxyhq/db/migrate` rather than
// carrying a second copy of the regex, so the gate and the migrator can never
// disagree about what a marker says. That module deliberately imports nothing
// but node builtins for this reason.
//
// It also refuses a journal entry with no `.sql` beside it, and a `.sql` with no
// journal entry. Both are silent in normal use: drizzle applies what the journal
// lists, so an orphan file is a migration nobody runs, and an orphan entry is an
// image shipped without its migrations.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJournal, readMigrationPhases } from "@oxyhq/db/migrate";

const folder = process.argv[2] ?? "packages/backend/drizzle";

let entries;
try {
  entries = readJournal(folder);
} catch (error) {
  console.error(
    `::error::Could not read the migration journal at ${folder}/meta/_journal.json: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

const problems = [];

// A journal that reads as empty is indistinguishable from a clean run, so it is
// a failure rather than a pass. This repository has at least one migration; a
// run finding none has a wrong path, not a clean tree.
if (entries.length === 0) {
  problems.push(
    `${folder}/meta/_journal.json lists no migrations. Either the path is wrong ` +
      "or the journal was truncated — an empty journal makes the migrator apply " +
      "nothing and exit 0.",
  );
}

const tags = entries.map((entry) => entry.tag);
const { phases, problems: phaseProblems } = readMigrationPhases(tags, folder);
problems.push(...phaseProblems);

// Orphan `.sql` files: present on disk, absent from the journal, therefore
// applied by nothing.
const onDisk = readdirSync(folder)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => name.slice(0, -".sql".length));
const journalled = new Set(tags);
for (const name of onDisk.filter((tag) => !journalled.has(tag))) {
  problems.push(
    `${name}.sql is not listed in meta/_journal.json, so nothing will ever apply it.`,
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error(
    `\n${problems.length} problem(s) across ${entries.length} migration(s) in ${folder}.`,
  );
  process.exit(1);
}

// Print what was found, not just that nothing failed: "0 problems" over an empty
// scan reads identically to a pass, and that is the mistake this whole class of
// gate exists to avoid.
for (const tag of tags) {
  console.log(`${tag}: ${phases.get(tag)}`);
}
console.log(`\n${entries.length} migration(s) checked in ${folder}, all declaring a deploy phase.`);
