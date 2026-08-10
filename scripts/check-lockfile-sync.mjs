#!/usr/bin/env bun

// Fail the build when bun.lock does not match the package.json files it describes.
//
// The rule — commit the lockfile in the SAME commit as the manifest change
// (~/AGENTS.md) — has never been enforced here. What it costs in this repository
// is concrete: every install that is not this one is `--frozen-lockfile`, and a
// frozen install on a desynced lockfile does not warn, it ABORTS with `lockfile
// had changes, but lockfile is frozen`. So a manifest change committed without
// its lockfile does not surface on the pull request that introduced it — it
// surfaces later, as a broken frontend deploy or a red CI run on somebody else's
// change.
//
// (The backend image is deliberately NOT covered by this: packages/backend/
// Dockerfile narrows `workspaces` to three packages and therefore does not copy
// bun.lock at all, resolving fresh from the version ranges. That is intentional —
// do not "fix" it by copying the lockfile in.)
//
// WHY NOT `--frozen-lockfile`
//
// It is the obvious gate and it fails OPEN. Measured on bun 1.3.14, it exits 0 on
// both desync shapes that actually reach main: a workspace package's own `version`
// bumped without regenerating the lockfile, and a dependency range widened to
// something the lockfile does not record (^2.9.0 → >=2.9.0, still satisfied by the
// locked resolution). It fails only when a range resolves to nothing at all — a
// resolution error, not a sync check. So it reads like enforcement while catching
// neither shape.
//
// WHY TWO CHECKS AND NOT JUST THE INSTALL
//
// The install-and-ask-git approach (OxyHQServices PR #734) is the right primary
// check and its mechanics are reused below. But it is NOT sufficient on its own,
// and the gap is in the highest-value mode: **a plain `bun install` does not
// rewrite a workspace package's recorded `version`.** Measured in fixtures and in
// CrowdSource, and re-verified against this repository's own fixtures — bun leaves
// the stale value in bun.lock and reports "no changes", so `git diff --quiet` says
// clean and an install-only gate exits 0. Verified independent of the cache (warm
// and cold) and independent of how dependents reference the package
// (`workspace:*` and a caret range on the published version behave identically).
//
// So what bun.lock records per workspace is compared against the manifests
// directly, before any install. That layer is the only thing standing between a
// version bump and a lockfile nobody regenerated.
//
// Churn is deliberately NOT accommodated. A reproduce-the-rewrite-twice scheme was
// built in CrowdSource and then removed: the non-deterministic lockfile churn it
// absorbed never fired across nine runs on warm and cold caches, and machinery for
// a failure that does not occur reads as load-bearing to whoever touches it next.
// If churn ever does surface, the failure output below names every changed line,
// which is enough to recognise it.
//
// Ported from CrowdSource scripts/check-lockfile-sync.mjs. Keep the two
// implementations in step: a fix to one belongs in the other.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// LOCKFILE_SYNC_ROOT exists so this check can be exercised against fixture
// repositories (see test-check-lockfile-sync.mjs). Nothing in CI sets it, so a
// real run always measures this repository.
const repositoryRoot = resolve(
  process.env.LOCKFILE_SYNC_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const LOCKFILE = "bun.lock";
const lockfilePath = join(repositoryRoot, LOCKFILE);
const ROOT_WORKSPACE = "";
const MAX_REPORTED_DIFF_LINES = 200;
const decoder = new TextDecoder();

function die(summary, details = []) {
  console.error(`::error::${summary}`);
  for (const detail of details) console.error(detail);
  process.exit(1);
}

function git(args, { allowFailure = false } = {}) {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!allowFailure && result.exitCode !== 0) {
    die(`git ${args.join(" ")} failed: ${decoder.decode(result.stderr).trim()}`);
  }
  return { exitCode: result.exitCode, stdout: decoder.decode(result.stdout) };
}

function lockfileIsDirty() {
  return git(["diff", "--quiet", "--", LOCKFILE], { allowFailure: true }).exitCode !== 0;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    die(`Could not read ${path} as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// bun writes bun.lock as JSON with trailing commas, which JSON.parse rejects. The
// substitution only removes a comma followed by whitespace and a closing brace or
// bracket; no package name, version range or integrity hash contains that
// sequence. A format change that defeats it surfaces as a parse failure or as the
// vacuity floor below, never as a check that quietly compares nothing.
function parseLockfile(text) {
  try {
    return JSON.parse(text.replace(/,(?=\s*[}\]])/g, ""));
  } catch (error) {
    die(
      `${LOCKFILE} could not be parsed, so what it records per workspace cannot be compared: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (git(["rev-parse", "--is-inside-work-tree"], { allowFailure: true }).exitCode !== 0) {
  die(
    `${repositoryRoot} is not a git work tree, so a regenerated ${LOCKFILE} cannot be compared against the committed one.`,
  );
}
// Borrowed from #734, and it matters: with an already-modified lockfile there is
// no way to tell what a fresh install altered from what was altered beforehand.
if (lockfileIsDirty()) {
  die(
    `${LOCKFILE} already has uncommitted changes, so this check cannot attribute what a fresh install would alter. Commit or stash it, then re-run.`,
  );
}

const rootManifest = await readJson(join(repositoryRoot, "package.json"));

// A lockfile written by a different bun can differ on formatting alone, so a
// difference this runtime caused must never be reported as the commit's.
const pinnedBunVersion = String(rootManifest.packageManager ?? "").replace(/^bun@/, "");
if (!pinnedBunVersion) {
  die(
    "package.json must declare packageManager as bun@<version>; without that pin a lockfile difference cannot be told apart from one the running bun introduced.",
  );
}
if (Bun.version !== pinnedBunVersion) {
  die(
    `This repository pins bun@${pinnedBunVersion} but bun ${Bun.version} is running. Install the pinned version before checking or regenerating ${LOCKFILE}.`,
  );
}

// ---------------------------------------------------------------------------
// Layer 1: what bun.lock records per workspace, against the manifests.
// A plain install does not repair any of this, so nothing else can catch it.
// ---------------------------------------------------------------------------

const lockfile = parseLockfile(await readFile(lockfilePath, "utf8"));
const recordedWorkspaces = lockfile.workspaces;
if (typeof recordedWorkspaces !== "object" || recordedWorkspaces === null) {
  die(`${LOCKFILE} records no workspaces object, so there is nothing to compare against the manifests.`);
}

const declaredPatterns = Array.isArray(rootManifest.workspaces) ? rootManifest.workspaces : [];
if (declaredPatterns.length === 0) {
  die("package.json declares no workspaces array, so the packages bun.lock should describe cannot be enumerated.");
}

const manifestWorkspacePaths = [ROOT_WORKSPACE];
for (const pattern of declaredPatterns) {
  const patternMatch = /^([A-Za-z0-9._-]+)\/\*$/.exec(String(pattern));
  if (!patternMatch) {
    die(
      `Unsupported workspace pattern ${pattern}. This check only models <directory>/*; teach it the new shape rather than letting it stop comparing workspaces.`,
    );
  }
  const [, workspaceDirectory] = patternMatch;
  for (const entry of await readdir(join(repositoryRoot, workspaceDirectory), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const workspacePath = `${workspaceDirectory}/${entry.name}`;
    if (!(await Bun.file(join(repositoryRoot, workspacePath, "package.json")).exists())) continue;
    manifestWorkspacePaths.push(workspacePath);
  }
}

// Vacuity floor: a workspace repository must record the root and at least one
// package, so a smaller set means the traversal or the lockfile format changed
// and every comparison below would pass by examining nothing.
if (manifestWorkspacePaths.length < 2 || Object.keys(recordedWorkspaces).length < 2) {
  die(
    `Found ${manifestWorkspacePaths.length} workspace manifest(s) and ${Object.keys(recordedWorkspaces).length} recorded workspace(s); a workspace repository has more than one of each, so this check cannot verify anything.`,
  );
}

const staleRecords = [];
for (const workspacePath of manifestWorkspacePaths) {
  if (!(workspacePath in recordedWorkspaces)) {
    staleRecords.push(`${workspacePath || "the repository root"} has a package.json that ${LOCKFILE} does not record.`);
  }
}
for (const workspacePath of Object.keys(recordedWorkspaces)) {
  if (!manifestWorkspacePaths.includes(workspacePath)) {
    staleRecords.push(`${LOCKFILE} records ${workspacePath}, which has no package.json.`);
  }
}

for (const workspacePath of manifestWorkspacePaths) {
  const recorded = recordedWorkspaces[workspacePath];
  if (typeof recorded !== "object" || recorded === null) continue;
  const label = workspacePath || "the repository root";
  const manifest = await readJson(join(repositoryRoot, workspacePath, "package.json"));

  if (manifest.name !== recorded.name) {
    staleRecords.push(
      `${label} is named ${JSON.stringify(manifest.name)} but ${LOCKFILE} records ${JSON.stringify(recorded.name)}.`,
    );
  }

  // bun does not record a version for the root workspace, which is private and
  // never resolved by anything. It does for every other workspace, so a missing
  // one means this comparison silently stopped covering the version mode.
  if (workspacePath === ROOT_WORKSPACE || manifest.version === undefined) continue;
  if (recorded.version === undefined) {
    staleRecords.push(
      `${label} declares version ${JSON.stringify(manifest.version)} but ${LOCKFILE} records no version for it.`,
    );
  } else if (manifest.version !== recorded.version) {
    staleRecords.push(
      `${label} is at version ${JSON.stringify(manifest.version)} but ${LOCKFILE} records ${JSON.stringify(recorded.version)}.`,
    );
  }
}

// bun records a SINGLE `overrides` object in bun.lock and folds `resolutions`
// into it — there is no separate `resolutions` key in the lockfile. So the set
// to compare against `lockfile.overrides` is the UNION of the manifest's
// `overrides` and `resolutions`, not `overrides` alone. Both spellings are
// load-bearing here: ~/AGENTS.md requires the Oxy SDK to be pinned in BOTH so
// bun cannot hoist a stale @oxyhq/core inside @oxyhq/services.
//
// A name pinned in both to DIFFERENT ranges is a self-contradiction — the value
// bun would fold is undefined — so surface it rather than silently pick a winner.
const declaredOverrides = {};
for (const [spelling, entries] of [
  ["overrides", rootManifest.overrides ?? {}],
  ["resolutions", rootManifest.resolutions ?? {}],
]) {
  if (typeof entries !== "object" || entries === null) {
    die(`package.json ${spelling} must be an object, so the versions it pins can be compared against ${LOCKFILE}.`);
  }
  for (const [name, range] of Object.entries(entries)) {
    if (name in declaredOverrides && declaredOverrides[name] !== range) {
      die(
        `package.json pins ${name} to conflicting versions across overrides and resolutions ` +
          `(${JSON.stringify(declaredOverrides[name])} vs ${JSON.stringify(range)}); make them agree so the ${LOCKFILE} fold is well-defined.`,
      );
    }
    declaredOverrides[name] = range;
  }
}
const recordedOverrides = lockfile.overrides ?? {};
for (const name of [...new Set([...Object.keys(declaredOverrides), ...Object.keys(recordedOverrides)])].sort()) {
  if (declaredOverrides[name] !== recordedOverrides[name]) {
    staleRecords.push(
      `override ${name} is ${JSON.stringify(declaredOverrides[name] ?? null)} in package.json but ${JSON.stringify(recordedOverrides[name] ?? null)} in ${LOCKFILE}.`,
    );
  }
}

if (staleRecords.length > 0) {
  die(`${LOCKFILE} does not match the manifests it describes:`, [
    ...staleRecords.map((record) => `  - ${record}`),
    "",
    `Fix: run \`bun install\` and commit ${LOCKFILE} in the SAME commit as the manifest change.`,
  ]);
}

// ---------------------------------------------------------------------------
// Layer 2: regenerate and ask git whether the file moved. A tracked file
// changing IS the desync, with no judgement about staleness required.
// ---------------------------------------------------------------------------

// --ignore-scripts matches how CI installs and keeps the root postinstall from
// building packages; it has no effect on resolution or on what bun writes.
const install = Bun.spawnSync({
  cmd: [process.execPath, "install", "--ignore-scripts"],
  cwd: repositoryRoot,
  stdout: "pipe",
  stderr: "pipe",
});
const installOutput = `${decoder.decode(install.stdout)}${decoder.decode(install.stderr)}`;
if (install.exitCode !== 0) {
  die(`\`bun install\` exited ${install.exitCode}, so the lockfile it would have produced cannot be compared.`, [
    installOutput,
  ]);
}
// bun has reported `error: Fail extracting tarball for "<package>"` and still
// exited 0, leaving that package absent from the tree. A gate that trusts the
// exit code measures an install that never completed.
const reportedErrors = installOutput.split("\n").filter((line) => /^\s*error:/.test(line));
if (reportedErrors.length > 0) {
  die("`bun install` reported an error while exiting 0, so its lockfile cannot be trusted.", reportedErrors);
}

if (!lockfileIsDirty()) {
  console.log(
    `${LOCKFILE} is in sync: it matches every package.json it records, and a plain \`bun install\` left it unchanged.`,
  );
  process.exit(0);
}

// Which workspace or package block each changed line falls inside. Line-oriented
// on purpose (bun.lock is JSONC and a hand-rolled tolerant parser would be a
// liability here): take the changed line numbers from a zero-context diff, then
// scan UP the regenerated file for the nearest enclosing entry and the section it
// belongs to. #734 scans only for a 4-space `"key": {`, which a change inside the
// `"packages"` section — whose entries are `"key": [` — would misattribute to a
// workspace far above it, so the section is resolved too.
const lines = (await readFile(lockfilePath, "utf8")).split("\n");

function changedBlocks() {
  const diff = git(["diff", "--unified=0", "--", LOCKFILE]).stdout;
  const blocks = new Set();

  for (const header of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(header[1]);
    const count = header[2] === undefined ? 1 : Number(header[2]);
    for (let line = start; line < start + Math.max(count, 1); line += 1) {
      let entry = null;
      let section = null;
      for (let cursor = line - 1; cursor >= 0 && section === null; cursor -= 1) {
        const text = lines[cursor] ?? "";
        if (entry === null) {
          const entryMatch = /^ {4}"([^"]*)": [{[]/.exec(text);
          if (entryMatch) {
            entry = entryMatch[1] === "" ? "the repository root" : entryMatch[1];
            continue;
          }
        }
        const sectionMatch = /^ {2}"([^"]+)": [{[]/.exec(text);
        if (sectionMatch) [, section] = sectionMatch;
      }
      blocks.add(
        section === null
          ? "lockfile metadata"
          : entry === null
            ? section
            : `${section} → ${entry}`,
      );
    }
  }
  return [...blocks].sort();
}

const blocks = changedBlocks();
const diffLines = git(["--no-pager", "diff", "--", LOCKFILE]).stdout.split("\n");
const shownDiff =
  diffLines.length > MAX_REPORTED_DIFF_LINES
    ? [
        ...diffLines.slice(0, MAX_REPORTED_DIFF_LINES),
        `… ${diffLines.length - MAX_REPORTED_DIFF_LINES} more diff line(s) omitted.`,
      ]
    : diffLines;

// Restore what was committed, so the check is idempotent: leaving the regenerated
// lockfile behind would make the next run refuse with "already has uncommitted
// changes" instead of reporting the desync again.
git(["checkout", "--", LOCKFILE]);

die(`${LOCKFILE} is OUT OF SYNC with the package.json files.`, [
  "",
  "A plain `bun install` rewrote it, so the committed lockfile does not reflect the",
  "current manifests. Affected block(s):",
  ...(blocks.length > 0 ? blocks.map((block) => `  - ${block}`) : ["  (none identified — see the diff below)"]),
  "",
  `Fix: run \`bun install\` and commit ${LOCKFILE} in the SAME commit as the manifest`,
  "change. A dependency or version bump without its lockfile aborts every frozen",
  `install that follows it, on somebody else's change. ${LOCKFILE} has been restored here.`,
  "",
  ...shownDiff,
]);
