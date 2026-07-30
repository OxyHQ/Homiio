#!/usr/bin/env bun

// States how many tests a suite actually ran, and refuses a count below a floor.
//
// A matrix entry that runs no tests reports success. Wrong working directory, a
// renamed script, a glob that stops matching, a traversal that breaks — every one
// of them exits 0 with an empty run, and the job stays green while gating
// nothing. That reads as coverage forever, because nothing ever contradicts it.
//
// The floor is a MINIMUM, not a target: raise it as suites grow, and lower it
// only deliberately, in the same change that removes the tests.
//
// Reads jest's `--json` report. Ported from CrowdSource, where the same script
// reads vitest's; the two reporters agree on the fields used here
// (`numTotalTests`, `numFailedTests`, `success`, `testResults`), which is checked
// by the format guard below rather than assumed.

import { readFile } from "node:fs/promises";

const [reportPath, label, minimumArgument] = process.argv.slice(2);
if (!reportPath || !label || !minimumArgument) {
  console.error("::error::usage: assert-test-floor.mjs <jest-json-report> <label> <minimum-tests>");
  process.exit(1);
}

const minimumTests = Number(minimumArgument);
if (!Number.isInteger(minimumTests) || minimumTests < 1) {
  console.error(`::error::${label}: the minimum test count must be a positive integer, got ${minimumArgument}.`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(await readFile(reportPath, "utf8"));
} catch (error) {
  // An unreadable report is the shape of a suite that never ran, so it must fail
  // rather than be treated as "nothing to check".
  console.error(
    `::error::${label}: could not read the test report at ${reportPath}, so the number of tests that ran is unknown: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

const totalTests = report.numTotalTests;
const failedTests = report.numFailedTests;
const files = Array.isArray(report.testResults) ? report.testResults.length : 0;
if (!Number.isInteger(totalTests) || !Number.isInteger(failedTests)) {
  console.error(
    `::error::${label}: the test report carries no numTotalTests/numFailedTests, so the run cannot be verified. The reporter's format may have changed.`,
  );
  process.exit(1);
}

console.log(`${label}: ${totalTests} test(s) across ${files} file(s), ${failedTests} failed.`);

const problems = [];
if (failedTests > 0 || report.success !== true) {
  // Reached only if the runner reported failures while still exiting 0.
  problems.push(`${failedTests} test(s) failed but the runner exited successfully.`);
}
if (totalTests < minimumTests) {
  problems.push(
    `only ${totalTests} test(s) ran, below the floor of ${minimumTests}. Either the suite shrank, or the runner found fewer test files than it should have and the job would otherwise have passed while gating nothing.`,
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${label}: ${problem}`);
  process.exit(1);
}
