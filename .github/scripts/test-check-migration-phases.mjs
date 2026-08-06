#!/usr/bin/env bun

// Mutation-tests the deploy-phase gate.
//
// The gate exists to refuse a migration that does not say which side of a deploy
// it belongs on, so the one thing it must never do is pass on a folder that is
// missing, empty, or full of unmarked files. Each case below breaks exactly one
// guarantee and requires the gate to fail AND to name the offending migration —
// a gate that fails without saying which file is wrong sends whoever hits it
// hunting, and a gate that passes an empty scan protects nothing at all.

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const gateScript = resolve(dirname(fileURLToPath(import.meta.url)), "check-migration-phases.mjs");
const workingDirectory = await mkdtemp(join(tmpdir(), "homiio-migration-phases-"));
const decoder = new TextDecoder();
const failures = [];

function runGate(folder) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, gateScript, folder],
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  };
}

/**
 * Build a migrations folder. `files` maps a tag to its `.sql` body, or to `null`
 * to journal a tag with no file beside it.
 */
async function buildFolder(name, files, { journalTags } = {}) {
  const folder = join(workingDirectory, name);
  await mkdir(join(folder, "meta"), { recursive: true });

  const tags = journalTags ?? Object.keys(files);
  await writeFile(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: tags.map((tag, index) => ({
        idx: index,
        version: "7",
        when: 1_700_000_000_000 + index,
        tag,
        breakpoints: true,
      })),
    }),
  );

  for (const [tag, body] of Object.entries(files)) {
    if (body === null) continue;
    await writeFile(join(folder, `${tag}.sql`), body);
  }
  return folder;
}

async function expectVerdict(caseName, folder, expectedExitCode, expectedFragment) {
  const { exitCode, output } = runGate(folder);
  if (exitCode !== expectedExitCode) {
    failures.push(`${caseName}: expected exit ${expectedExitCode}, got ${exitCode}.\n${output}`);
    return;
  }
  if (!output.includes(expectedFragment)) {
    failures.push(
      `${caseName}: output does not contain ${JSON.stringify(expectedFragment)}.\n${output}`,
    );
  }
}

const GOOD = "-- oxy:deploy-phase=pre\nCREATE TABLE a (id text primary key);\n";

// The control. Without it, a gate that failed on EVERYTHING would pass every
// other case here and look perfectly healthy.
await expectVerdict(
  "a correctly marked migration",
  await buildFolder("good", { "0000_good": GOOD }),
  0,
  "0000_good: pre",
);

await expectVerdict(
  "a post-phase migration",
  await buildFolder("post", {
    "0000_drop": "-- oxy:deploy-phase=post\nALTER TABLE a DROP COLUMN b;\n",
  }),
  0,
  "0000_drop: post",
);

await expectVerdict(
  "no marker at all",
  await buildFolder("unmarked", { "0000_unmarked": "CREATE TABLE a (id text);\n" }),
  1,
  "0000_unmarked",
);

await expectVerdict(
  "two markers",
  await buildFolder("double", {
    "0000_double": "-- oxy:deploy-phase=pre\n-- oxy:deploy-phase=post\nSELECT 1;\n",
  }),
  1,
  "0000_double",
);

await expectVerdict(
  "an unrecognised phase",
  await buildFolder("bogus", { "0000_bogus": "-- oxy:deploy-phase=later\nSELECT 1;\n" }),
  1,
  "0000_bogus",
);

await expectVerdict(
  "a journalled migration with no .sql file",
  await buildFolder("missing", { "0000_missing": null }),
  1,
  "0000_missing",
);

await expectVerdict(
  "a .sql file absent from the journal",
  await buildFolder("orphan", { "0000_good": GOOD, "0001_orphan": GOOD }, {
    journalTags: ["0000_good"],
  }),
  1,
  "0001_orphan",
);

// An empty journal is the vacuity case: it produces no per-file complaint, so a
// gate that only iterated entries would report success over a folder that
// applies nothing.
await expectVerdict("an empty journal", await buildFolder("empty", {}), 1, "lists no migrations");

await expectVerdict(
  "a folder that does not exist",
  join(workingDirectory, "nonexistent"),
  1,
  "Could not read the migration journal",
);

await rm(workingDirectory, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`);
  console.error(`\n${failures.length} migration-phase gate case(s) failed.`);
  process.exit(1);
}

console.log("check-migration-phases.mjs: 9 case(s) passed — the gate still discriminates.");
