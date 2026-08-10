#!/usr/bin/env bun

// Fail the build when Homiio's authoritative documentation stops describing
// Homiio.
//
// Documentation is the one artefact nothing ever recomputes. A wrong line in a
// controller breaks a test; a wrong line in a doc page is read by the next
// person — increasingly, the next AGENT — and acted on. A convincing but false
// description is worse than no description: it produces a second source of
// truth, or the reintroduction of a pattern that was deliberately removed.
//
// Three checks, and the reason there are three rather than one is that they fail
// in different directions:
//
//   1. VOCABULARY — an authoritative page must not describe a datastore or a
//      wire contract this repository does not have.
//   2. LINKS — an internal link must resolve. A rotted link is how a page keeps
//      its authority while pointing nowhere.
//   3. ROUTES — every mounted Express router and every top-level Expo Router
//      segment must appear in docs/routes.mdx. A route table is only useful
//      while it is complete, and it goes stale the first time somebody adds a
//      router without touching docs.
//
// WHY IT IS NOT A JEST TEST
//
// The backend suite requires a reachable Postgres (deliberately — it refuses to
// start rather than skipping). This gate is about repository-level markdown and
// has no business needing a database to run. It follows the same shape as
// scripts/check-lockfile-sync.mjs: a standalone script, plus a mutation test
// that breaks what it guards and fails if the guard still passes.
//
// DOCS_CHECK_ROOT exists so the mutation test can point the whole thing at a
// fixture tree. Nothing in CI sets it.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(
  process.env.DOCS_CHECK_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
);

/**
 * The pages that describe the CURRENT system, as an AFFIRMATIVE list of globs.
 *
 * Affirmative on purpose, exactly like `SCANNED_ROOTS` in
 * `packages/backend/__tests__/unit/mongoUnreachable.test.ts`: a new directory
 * cannot silently widen the exemption by appearing, because it is simply not
 * scanned until somebody adds it here on purpose. The alternative — "everything
 * except a deny-list" — rots the moment a directory is added and nobody
 * remembers to deny it.
 *
 * What is deliberately NOT here, and why, because an unexplained omission is
 * indistinguishable from an oversight:
 *
 *   - `docs/adr/*.md` (the records themselves) — an ADR is a DATED decision
 *     record. It cites the state it replaced in order to justify the decision,
 *     and rewriting that citation later would destroy the reasoning. The ADR
 *     INDEX (`docs/adr/README.md`) is scanned, because it describes the present.
 *   - `docs/qa/**`, `docs/superpowers/**` — archived matrices and design specs,
 *     kept as records of what was thought at the time.
 *   - `packages/backend/db/MIGRATION-CONTRACT.md` and
 *     `db/schema/CONVENTIONS.md` — the migration's own contract and per-table
 *     decision log. Naming what each table was ported FROM is the entire job of
 *     those two files.
 */
const SCANNED_GLOBS = [
  "README.md",
  "AGENTS.md",
  "docs/*.mdx",
  "docs/adr/README.md",
  "packages/*/README.md",
  "packages/*/docs/*.md",
];

/**
 * Vocabulary that must not appear in a scanned page except inside an exemption
 * block.
 *
 * Each term is one this repository deliberately does not use any more, chosen so
 * that a false positive is unlikely rather than merely rare:
 *
 *   - `TTL` alone is NOT forbidden — it is a generic concept, and "Postgres has
 *     no TTL" is a true sentence somebody may need to write. `TTL index` and
 *     `expireAfterSeconds` are the datastore-specific spellings.
 *   - `_id` is matched with a boundary that does NOT fire inside `oxy_user_id`,
 *     `city_id` or `address_id`, which are real column names here.
 *   - Aggregation operators are limited to ones with no other meaning. `$set`
 *     and `$match` are excluded because they collide with ordinary prose and
 *     with other tools.
 */
const FORBIDDEN = [
  { pattern: /mongoose/i, why: "the ORM was removed; the store is PostgreSQL via Drizzle" },
  { pattern: /mongodb/i, why: "MongoDB is not a datastore in this repository" },
  { pattern: /\bmongo\b/i, why: "MongoDB is not a datastore in this repository" },
  { pattern: /MONGODB_URI/, why: "the secret is deleted from every task definition and from SSM" },
  { pattern: /ObjectId/, why: "identities are uuid v7 text, not ObjectIds" },
  { pattern: /(^|[^A-Za-z0-9_])_id([^A-Za-z0-9_]|$)/, why: "the wire contract names every identity `id`" },
  { pattern: /2dsphere/, why: "geospatial indexes are PostGIS GiST, not 2dsphere" },
  { pattern: /expireAfterSeconds/, why: "expiry is the sweep in db/expiry.ts, not an index option" },
  { pattern: /TTL index/i, why: "expiry is the sweep in db/expiry.ts, not an index" },
  { pattern: /\$lookup/, why: "joins are SQL joins" },
  { pattern: /\$bucket\b/, why: "histograms use width_bucket" },
  { pattern: /\$geoWithin/, why: "geospatial predicates are PostGIS functions" },
  { pattern: /\$centerSphere/, why: "geospatial predicates are PostGIS functions" },
  { pattern: /\.lean\(\)/, why: "there is no ORM document to flatten" },
];

/**
 * The exemption markers.
 *
 * THE RULE, and it lives here because this is where somebody reaching for an
 * exemption will be looking:
 *
 *   A scanned page may use forbidden vocabulary ONLY to say something that
 *   cannot be said without it. There are exactly three legitimate shapes:
 *
 *     (a) STATING WHAT WAS REMOVED, so the removal is verifiable — "MONGODB_URI
 *         is off both task definitions and deleted from SSM" is checkable
 *         against SSM; "the old secret is gone" is not.
 *     (b) NAMING A TERM IN ORDER TO FORBID IT — the wire contract "every
 *         identity is `id`, never `_id`" is unstatable otherwise.
 *     (c) AN INSTRUMENT — a census command must contain the term it searches
 *         for, or it measures nothing.
 *
 *   What is NEVER legitimate is describing LIVE BEHAVIOUR. "Properties are
 *   stored as documents", "the TTL index reaps external listings", a response
 *   example containing `_id` — those are the failures this gate exists for, and
 *   no exemption reason makes them true.
 *
 * The distinction is intentionally a judgement made by a human and recorded in
 * the marker, not a regex. A tense-detecting heuristic would be wrong in both
 * directions, and being wrong in the permissive direction is how the false
 * claims got here in the first place.
 *
 * The reason is REQUIRED and must be substantive, and every block must actually
 * contain a forbidden term — an exemption around clean prose is either a leftover
 * or a place something is hiding, and a reader a year from now cannot tell those
 * apart.
 */
const EXEMPT_START = /<!--\s*vocabulary-exempt:start\s+(.+?)\s*-->/;
const EXEMPT_END = /<!--\s*vocabulary-exempt:end\s*-->/;
const MIN_REASON_LENGTH = 20;

/**
 * Vacuity floors. Every one of these numbers is a MINIMUM measured on this
 * branch and set below the measurement, so ordinary editing does not trip it.
 *
 * They exist because the failure mode of every check in this file is an EMPTY
 * input: a broken `git ls-files`, a glob that stops matching, a rename that
 * empties `SCANNED_GLOBS`. An empty scan passes every assertion by examining
 * nothing, and that is indistinguishable from a clean tree.
 */
const FLOORS = {
  // 25 measured on docs/architecture-vocabulary-349 at base bf3ef48b.
  //
  // Measure it with the new pages STAGED. `git ls-files` reports the INDEX, so
  // an untracked page is not in the scan — which is how four new documents were
  // silently unscanned here until `git add` was run, and the count jumped 21→25
  // along with three real findings the earlier runs could not see.
  scannedFiles: 18,
  // 39 measured on the same commit.
  trackedMarkdown: 25,
  // 20 measured — `router.use('/<name>', …)` calls in routes/index.ts.
  mountedRouters: 14,
  // 24 measured — top-level segments under packages/frontend/app/.
  frontendSegments: 16,
};

const ROUTES_DOC = "docs/routes.mdx";

const failures = [];

function fail(check, message, detail = []) {
  failures.push({ check, message, detail });
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

/**
 * Enumerate with `git ls-files`, never a directory walk — the scan then cannot
 * disagree with the set git actually tracks, and build output is excluded for
 * free rather than by an ignore list that rots.
 */
function trackedMarkdown() {
  return git(["ls-files", "--", "*.md", "*.mdx"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Match a `dir/*.ext` or literal glob against a repo-relative path. */
function matchesGlob(path, glob) {
  const pattern = new RegExp(
    `^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`,
  );
  return pattern.test(path);
}

function scannedFiles(tracked) {
  return tracked.filter((path) => SCANNED_GLOBS.some((glob) => matchesGlob(path, glob)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. VOCABULARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a document into lines, marking which are inside an exemption block, and
 * report structural problems with the blocks themselves.
 */
function readWithExemptions(path, source) {
  const lines = source.split("\n");
  const marked = [];
  const blocks = [];
  let open = null;

  lines.forEach((line, index) => {
    const start = EXEMPT_START.exec(line);
    if (start) {
      if (open) {
        fail("vocabulary", `${path}:${index + 1} — nested vocabulary-exempt block`);
      }
      open = { reason: start[1], startLine: index + 1, sawForbidden: false };
      marked.push({ line, exempt: true, number: index + 1 });
      return;
    }
    if (EXEMPT_END.test(line)) {
      if (!open) {
        fail("vocabulary", `${path}:${index + 1} — vocabulary-exempt:end without a start`);
      } else {
        blocks.push(open);
        open = null;
      }
      marked.push({ line, exempt: true, number: index + 1 });
      return;
    }
    marked.push({ line, exempt: open !== null, number: index + 1 });
    if (open && FORBIDDEN.some(({ pattern }) => pattern.test(line))) {
      open.sawForbidden = true;
    }
  });

  if (open) {
    fail("vocabulary", `${path}:${open.startLine} — vocabulary-exempt block is never closed`);
  }
  return { marked, blocks };
}

function checkVocabulary(files) {
  for (const path of files) {
    const source = readFileSync(join(ROOT, path), "utf8");
    const { marked, blocks } = readWithExemptions(path, source);

    for (const { line, exempt, number } of marked) {
      if (exempt) continue;
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(line)) {
          fail(
            "vocabulary",
            `${path}:${number} — forbidden term (${why})`,
            // Print the FULL matched line. A truncated capture group reads as a
            // confirmed match even when the pattern matched something else.
            [`    ${line.trim()}`],
          );
        }
      }
    }

    for (const block of blocks) {
      if (block.reason.trim().length < MIN_REASON_LENGTH) {
        fail(
          "vocabulary",
          `${path}:${block.startLine} — vocabulary-exempt needs a substantive reason ` +
            `(at least ${MIN_REASON_LENGTH} characters), got "${block.reason}"`,
        );
      }
      if (!block.sawForbidden) {
        fail(
          "vocabulary",
          `${path}:${block.startLine} — vocabulary-exempt block contains no forbidden term, ` +
            "so it exempts nothing. Remove it: an exemption nothing needs is " +
            "indistinguishable from one something is hiding behind.",
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. LINKS
// ─────────────────────────────────────────────────────────────────────────────

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Blank out fenced code blocks, preserving line count.
 *
 * Without this the link scanner reports false positives on ordinary code, and
 * they are not exotic: a character class followed by a group —
 * `["\x27]([^"\x27]*)["\x27]` inside a documented `perl -0777` one-liner — is
 * `[…](…)` as far as a markdown link regex is concerned. It resolved to a
 * nonsense path and failed the build on correct prose.
 *
 * A gate that cries wolf gets disabled by whoever hits it next, so a known false
 * positive is fixed BEFORE the gate is armed, not after.
 *
 * Lines are blanked rather than removed so reported line numbers stay true.
 */
function stripCodeFences(source) {
  const lines = source.split("\n");
  let fence = null;
  return lines
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line);
      if (marker) {
        if (fence === null) {
          fence = marker[1][0];
          return "";
        }
        if (marker[1][0] === fence) {
          fence = null;
          return "";
        }
      }
      return fence === null ? line : "";
    })
    .join("\n");
}

/**
 * Resolve one internal link target.
 *
 * Two forms have to work, because the docs are read in two places:
 *
 *   - A FILE path (`docs/routes.mdx`, `packages/backend/db/expiry.ts`), which is
 *     what somebody browsing the repository or an agent reading the tree
 *     follows.
 *   - An EXTENSION-LESS docs slug (`./routes`, `./adr/0001-canonical-housing-graph`),
 *     which is what the Oxy docs site serves — its sync script derives a page's
 *     slug from its path with the extension stripped.
 *
 * Anything absolute, external, or an anchor is out of scope: a link checker that
 * hits the network is a job people disable the first time a third-party site is
 * slow, and a gate nobody runs is worse than none.
 */
function resolveLink(fromFile, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return { kind: "external" };
  if (target.startsWith("#")) return { kind: "anchor" };
  if (target.startsWith("//")) return { kind: "external" };

  const [rawPath] = target.split("#");
  if (!rawPath) return { kind: "anchor" };

  const base = target.startsWith("/") ? ROOT : join(ROOT, dirname(fromFile));
  const candidate = resolve(base, target.startsWith("/") ? `.${rawPath}` : rawPath);

  if (!candidate.startsWith(ROOT)) {
    return { kind: "outside", candidate };
  }
  if (existsSync(candidate)) return { kind: "ok" };
  for (const extension of [".mdx", ".md"]) {
    if (existsSync(`${candidate}${extension}`)) return { kind: "ok" };
  }
  // A docs slug pointing at a directory index.
  for (const index of ["index.mdx", "index.md", "README.md"]) {
    if (existsSync(join(candidate, index))) return { kind: "ok" };
  }
  return { kind: "missing", candidate };
}

function checkLinks(files) {
  for (const path of files) {
    const source = stripCodeFences(readFileSync(join(ROOT, path), "utf8"));
    for (const match of source.matchAll(LINK)) {
      const target = match[1];
      const result = resolveLink(path, target);
      if (result.kind === "missing") {
        fail("links", `${path} — link target does not exist: ${target}`, [
          `    resolved to ${relative(ROOT, result.candidate)}`,
        ]);
      }
      if (result.kind === "outside") {
        fail("links", `${path} — link escapes the repository: ${target}`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every path `routes/index.ts` mounts.
 *
 * Read with a MULTILINE regex rather than a line-based grep. Half of this
 * repository's route registrations put the path on the line after the call, and
 * `\s` in a line-based pattern does not cross a newline — such a search reports
 * zero matches, which reads exactly like "there is nothing to find". Measured on
 * this repository: a line-based sweep of `router.<verb>(` finds 5 routers'
 * worth of routes and misses 5 others entirely.
 */
function mountedRouters() {
  const source = readFileSync(join(ROOT, "packages/backend/routes/index.ts"), "utf8");
  const mounts = new Set();
  for (const match of source.matchAll(/router\s*\.\s*use\s*\(\s*["'](\/[a-z-]+)["']/gs)) {
    mounts.add(match[1]);
  }
  return [...mounts].sort();
}

/** Every top-level segment under the Expo Router app directory. */
function frontendSegments() {
  const files = git(["ls-files", "--", "packages/frontend/app/"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const segments = new Set();
  for (const file of files) {
    const relativePath = file.replace("packages/frontend/app/", "");
    const [head] = relativePath.split("/");
    // `_layout.tsx`, `+html.tsx`, `+not-found.tsx` are framework files, not routes.
    if (head.startsWith("_") || head.startsWith("+")) continue;
    segments.add(head.replace(/\.(tsx|ts)$/, ""));
  }
  return [...segments].sort();
}

function checkRoutes() {
  const routesDocPath = join(ROOT, ROUTES_DOC);
  if (!existsSync(routesDocPath)) {
    fail("routes", `${ROUTES_DOC} does not exist`);
    return;
  }
  const doc = readFileSync(routesDocPath, "utf8");

  const routers = mountedRouters();
  if (routers.length < FLOORS.mountedRouters) {
    fail(
      "routes",
      `only ${routers.length} mounted routers found in routes/index.ts, expected at least ` +
        `${FLOORS.mountedRouters}. The extraction is broken, not the code.`,
    );
  }
  for (const mount of routers) {
    if (!doc.includes(`/api${mount}`)) {
      fail("routes", `${ROUTES_DOC} does not mention the mounted router /api${mount}`);
    }
  }

  const segments = frontendSegments();
  if (segments.length < FLOORS.frontendSegments) {
    fail(
      "routes",
      `only ${segments.length} top-level frontend segments found, expected at least ` +
        `${FLOORS.frontendSegments}. The extraction is broken, not the app.`,
    );
  }
  for (const segment of segments) {
    // Require the segment as a BACKTICKED token, not a bare substring.
    //
    // A substring test is what this check first did, and mutation testing killed
    // it: deleting `roommates` from the frontend table still passed, because
    // `/api/roommates` two tables up contains the same eight characters. Every
    // frontend segment here shares a name with a backend mount, so a substring
    // test could never fail for any of them — a check that cannot fail.
    //
    // `(tabs)` is a route GROUP and the doc names it with its parentheses, which
    // this handles for free since the whole token is compared.
    if (!doc.includes(`\`${segment}\``)) {
      fail(
        "routes",
        `${ROUTES_DOC} does not mention the frontend route segment \`${segment}\` ` +
          "(it must appear as a backticked token, not merely as a substring)",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const tracked = trackedMarkdown();
if (tracked.length < FLOORS.trackedMarkdown) {
  fail(
    "setup",
    `git ls-files reported only ${tracked.length} markdown files, expected at least ` +
      `${FLOORS.trackedMarkdown}. The enumeration is broken; an empty scan passes ` +
      "every check below by examining nothing.",
  );
}

const files = scannedFiles(tracked);
if (files.length < FLOORS.scannedFiles) {
  fail(
    "setup",
    `only ${files.length} authoritative pages matched SCANNED_GLOBS, expected at least ` +
      `${FLOORS.scannedFiles}. A glob has stopped matching.`,
  );
}

// Every scanned path must be a real file. An entry naming something deleted
// would otherwise silently narrow the scan.
for (const path of files) {
  const full = join(ROOT, path);
  if (!existsSync(full) || !statSync(full).isFile()) {
    fail("setup", `${path} is tracked but not readable as a file`);
  }
}

if (failures.length === 0) {
  checkVocabulary(files);
  checkLinks(files);
  checkRoutes();
}

if (failures.length > 0) {
  const byCheck = new Map();
  for (const failure of failures) {
    if (!byCheck.has(failure.check)) byCheck.set(failure.check, []);
    byCheck.get(failure.check).push(failure);
  }
  console.error("Documentation check FAILED.\n");
  for (const [check, entries] of byCheck) {
    console.error(`## ${check} (${entries.length})`);
    for (const entry of entries) {
      console.error(`  - ${entry.message}`);
      for (const line of entry.detail) console.error(line);
    }
    console.error("");
  }
  console.error(
    "The vocabulary rule and the three legitimate uses of an exemption are documented at\n" +
      "the top of scripts/check-docs.mjs. Describing LIVE behaviour with removed vocabulary\n" +
      "is never exemptible.",
  );
  process.exit(1);
}

console.log(
  `Documentation OK — ${files.length} authoritative page(s) scanned ` +
    `(of ${tracked.length} tracked markdown files), ` +
    `${mountedRouters().length} mounted router(s) and ` +
    `${frontendSegments().length} frontend segment(s) documented.`,
);
