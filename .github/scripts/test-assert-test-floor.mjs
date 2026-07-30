#!/usr/bin/env bun

// Mutation-tests the vacuity floor. The floor exists to catch a suite that ran
// nothing, so the one thing it must never do is pass on an empty or missing
// report — and that is exactly the case a floor added carelessly gets wrong.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const assertScript = resolve(dirname(fileURLToPath(import.meta.url)), "assert-test-floor.mjs");
const workingDirectory = await mkdtemp(join(tmpdir(), "homiio-test-floor-"));
const decoder = new TextDecoder();
const failures = [];

function runAssert(args) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, assertScript, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  };
}

async function writeReport(name, report) {
  const path = join(workingDirectory, name);
  await writeFile(path, JSON.stringify(report));
  return path;
}

async function expectVerdict(caseName, args, expectedExitCode, expectedFragment) {
  const { exitCode, output } = runAssert(args);
  if (exitCode !== expectedExitCode) {
    failures.push(`${caseName}: expected exit ${expectedExitCode}, got ${exitCode}.\n${output}`);
    return;
  }
  if (!output.includes(expectedFragment)) {
    failures.push(`${caseName}: output does not contain ${JSON.stringify(expectedFragment)}.\n${output}`);
  }
}

const healthy = { numTotalTests: 175, numFailedTests: 0, success: true, testResults: Array.from({ length: 11 }, () => ({})) };

// A real run above its floor passes, and states the count it measured.
await expectVerdict(
  "above-floor",
  [await writeReport("healthy.json", healthy), "packages/contracts", "150"],
  0,
  "packages/contracts: 175 test(s) across 11 file(s), 0 failed.",
);

// The collapse this floor exists for: a runner that found almost nothing.
await expectVerdict(
  "collapsed-suite",
  [
    await writeReport("collapsed.json", { ...healthy, numTotalTests: 2, testResults: [{}] }),
    "packages/contracts",
    "150",
  ],
  1,
  "only 2 test(s) ran, below the floor of 150",
);

// Zero tests is the shape of a wrong working directory or a broken glob.
await expectVerdict(
  "empty-suite",
  [await writeReport("empty.json", { ...healthy, numTotalTests: 0, testResults: [] }), "packages/sdk", "60"],
  1,
  "only 0 test(s) ran, below the floor of 60",
);

// A report that says tests failed while the runner exited 0 must not pass.
await expectVerdict(
  "failed-tests-reported",
  [
    await writeReport("failed.json", { ...healthy, numFailedTests: 3, success: false }),
    "packages/sdk-express",
    "45",
  ],
  1,
  "3 test(s) failed but the runner exited successfully.",
);

// A missing report is a suite that never ran, not "nothing to check".
await expectVerdict(
  "missing-report",
  [join(workingDirectory, "does-not-exist.json"), "packages/testing", "12"],
  1,
  "could not read the test report",
);

// A reporter whose format changed must fail loudly rather than silently stop counting.
await expectVerdict(
  "unrecognised-report",
  [await writeReport("shape.json", { total: 175 }), "packages/testing", "12"],
  1,
  "carries no numTotalTests/numFailedTests",
);

await expectVerdict("missing-arguments", [], 1, "usage: assert-test-floor.mjs");

if (workingDirectory.startsWith(join(tmpdir(), "homiio-test-floor-"))) {
  await rm(workingDirectory, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("Test floor assertion tests failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Test floor assertion tests passed.");
