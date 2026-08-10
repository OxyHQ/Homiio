#!/usr/bin/env bun

// Mutation-tests check-docs.mjs.
//
// A gate that cannot fail is indistinguishable from a gate that cannot pass, and
// the way a documentation gate stops discriminating is silent: a glob that no
// longer matches, a regex broken into never matching, an enumeration that
// returns nothing. Every one of those produces a GREEN run, which is exactly
// what a clean tree produces.
//
// So each case below breaks something the check claims to guard and requires the
// check to (a) exit non-zero and (b) NAME the offending path. Naming it matters
// as much as failing: a gate that says "documentation is wrong somewhere" gets
// disabled by whoever hits it next.
//
// The fixtures are real git repositories, because check-docs.mjs enumerates with
// `git ls-files`. A directory of files with no git index would make every scan
// empty — and an empty scan passes, which would make this whole suite vacuous in
// the precise way it exists to prevent. The `git add` in `commit()` is therefore
// load-bearing, not tidiness.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const checkScript = resolve(dirname(fileURLToPath(import.meta.url)), "check-docs.mjs");
const decoder = new TextDecoder();
const created = [];
const failures = [];
let ran = 0;

function run(root) {
  const result = Bun.spawnSync({
    cmd: ["bun", checkScript],
    cwd: root,
    env: { ...process.env, DOCS_CHECK_ROOT: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  };
}

function git(root, args) {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${decoder.decode(result.stderr)}`);
  }
}

async function write(root, path, contents) {
  await mkdir(join(root, dirname(path)), { recursive: true });
  await writeFile(join(root, path), contents);
}

/**
 * A fixture repository that PASSES, so every mutation below starts from green.
 *
 * Without this baseline a red result proves nothing: it could be the mutation or
 * it could be the fixture. `case: baseline` is the control.
 */
async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "homiio-docs-check-"));
  created.push(root);
  git(root, ["init", "-q"]);

  // Enough authoritative pages to clear the scanned-file floor (18).
  const pages = [
    "README.md",
    "AGENTS.md",
    "docs/adr/README.md",
    "packages/backend/README.md",
    "packages/frontend/README.md",
    "packages/shared-types/README.md",
    "packages/backend/docs/one.md",
    "packages/frontend/docs/two.md",
  ];
  for (const page of pages) {
    await write(root, page, `# ${page}\n\nPostgreSQL, via Drizzle. Nothing to see.\n`);
  }
  for (let i = 0; i < 14; i += 1) {
    await write(root, `docs/page-${i}.mdx`, `---\ntitle: Page ${i}\norder: ${i}\n---\n\n# Page ${i}\n`);
  }

  // Unscanned markdown, so the tracked-markdown floor (25) is cleared and the
  // affirmative-scope behaviour is exercised: these are FULL of forbidden
  // vocabulary and must not fail the gate.
  for (let i = 0; i < 6; i += 1) {
    await write(
      root,
      `docs/qa/archive-${i}.md`,
      `# Archived ${i}\n\nThis used mongoose and MongoDB and _id and a TTL index.\n`,
    );
  }

  // routes doc + the backend/frontend trees it is checked against.
  const mounts = [
    "properties", "rooms", "leases", "applications", "viewings", "reservations",
    "exchanges", "roommates", "reviews", "addresses", "evictions", "partners",
    "profiles", "notifications", "analytics", "ai", "images", "billing",
    "telegram", "scraper",
  ];
  const segments = [
    "explore", "search", "properties", "addresses", "agency", "reviews",
    "evictions", "contracts", "applications", "landlord", "viewings",
    "reservations", "stays", "host", "exchange", "roommates", "agent",
    "insights", "horizon", "tips", "settings", "notifications", "donate",
    "(tabs)",
  ];
  await write(
    root,
    "docs/routes.mdx",
    `---\ntitle: Routes\norder: 5\n---\n\n# Routes\n\n` +
      mounts.map((m) => `- \`/api/${m}\``).join("\n") +
      `\n\n` +
      segments.map((s) => `- \`${s}\``).join("\n") +
      `\n`,
  );
  await write(
    root,
    "packages/backend/routes/index.ts",
    `import express from 'express';\nexport default function () {\n  const router = express.Router();\n` +
      // Deliberately split across lines: the real file does this, and a
      // line-based extractor would find nothing.
      mounts
        .map((m) => `  router.use(\n    '/${m}',\n    ${m}Routes\n  );`)
        .join("\n") +
      `\n  return router;\n}\n`,
  );
  for (const segment of segments) {
    await write(root, `packages/frontend/app/${segment}/index.tsx`, "export default function S() { return null; }\n");
  }
  await write(root, "packages/frontend/app/_layout.tsx", "export default function L() { return null; }\n");

  commit(root);
  return root;
}

function commit(root) {
  git(root, ["add", "-A", "-f"]);
  git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "fixture", "--allow-empty"]);
}

function expect(name, condition, detail) {
  ran += 1;
  if (!condition) failures.push(`${name}: ${detail}`);
}

/**
 * The shape every mutation case shares: break something, require RED, require
 * the message to name the file, restore, require GREEN again.
 *
 * The restore-to-green half is not ceremony. It is what distinguishes "the
 * mutation caused the failure" from "the fixture was already broken" — the same
 * ambiguity that makes a surviving mutation and a never-applied mutation look
 * identical.
 */
async function mutation(name, root, path, contents, mustMention) {
  const original = await readFile(join(root, path), "utf8").catch(() => null);
  await write(root, path, contents);
  commit(root);
  const red = run(root);
  expect(name, red.exitCode !== 0, `expected a non-zero exit, got ${red.exitCode}\n${red.output}`);
  for (const needle of mustMention) {
    // Case-insensitive: the failure output echoes the offending LINE verbatim,
    // so a term written `Mongoose` in prose will not match a lowercase needle.
    // Comparing case-sensitively made this assertion fail on a correct gate.
    expect(
      `${name} (names ${needle})`,
      red.output.toLowerCase().includes(needle.toLowerCase()),
      `output did not mention "${needle}":\n${red.output}`,
    );
  }
  if (original === null) {
    await rm(join(root, path));
  } else {
    await write(root, path, original);
  }
  commit(root);
  const green = run(root);
  expect(
    `${name} (restores)`,
    green.exitCode === 0,
    `expected 0 after restoring, got ${green.exitCode}\n${green.output}`,
  );
}

const root = await createFixture();

// ── Control ────────────────────────────────────────────────────────────────
{
  const baseline = run(root);
  expect("baseline", baseline.exitCode === 0, `fixture is not green:\n${baseline.output}`);
  expect(
    "baseline (reports a count)",
    /\d+ authoritative page\(s\) scanned/.test(baseline.output),
    `expected a scanned count:\n${baseline.output}`,
  );
}

// ── 1. Forbidden vocabulary asserting live behaviour ───────────────────────
await mutation(
  "planted mongoose claim",
  root,
  "docs/page-3.mdx",
  "---\ntitle: Page 3\norder: 3\n---\n\n# Page 3\n\nProperties are stored with Mongoose.\n",
  ["docs/page-3.mdx", "mongoose"],
);

await mutation(
  "planted _id response example",
  root,
  "docs/page-4.mdx",
  '---\ntitle: Page 4\norder: 4\n---\n\n# Page 4\n\n```json\n{ "_id": "abc" }\n```\n',
  ["docs/page-4.mdx"],
);

await mutation(
  "planted TTL index claim in a package README",
  root,
  "packages/backend/README.md",
  "# Backend\n\nExternal listings are reaped by a TTL index on `expiresAt`.\n",
  ["packages/backend/README.md"],
);

// A term that legitimately looks similar must NOT fire. `oxy_user_id` and
// `address_id` are real column names; a boundary that matched them would make
// the gate cry wolf, and a gate that cries wolf gets disabled.
await (async () => {
  ran += 1;
  await write(
    root,
    "docs/page-5.mdx",
    "---\ntitle: Page 5\norder: 5\n---\n\n# Page 5\n\nColumns: `oxy_user_id`, `address_id`, `city_id`. Postgres has no TTL behaviour.\n",
  );
  commit(root);
  const result = run(root);
  if (result.exitCode !== 0) {
    failures.push(`false positive on snake_case ids: exit ${result.exitCode}\n${result.output}`);
  }
  await write(root, "docs/page-5.mdx", "---\ntitle: Page 5\norder: 5\n---\n\n# Page 5\n");
  commit(root);
})();

// ── 2. Exemption blocks ────────────────────────────────────────────────────
{
  // A properly-marked exemption PASSES.
  ran += 1;
  await write(
    root,
    "docs/page-6.mdx",
    "---\ntitle: Page 6\norder: 6\n---\n\n# Page 6\n\n" +
      "<!-- vocabulary-exempt:start states the wire contract by naming the token it forbids -->\n" +
      "Every identity is `id`, never `_id`.\n" +
      "<!-- vocabulary-exempt:end -->\n",
  );
  commit(root);
  const result = run(root);
  if (result.exitCode !== 0) {
    failures.push(`a correctly-marked exemption was rejected:\n${result.output}`);
  }
}

await mutation(
  "exemption with a trivial reason",
  root,
  "docs/page-6.mdx",
  "---\ntitle: Page 6\norder: 6\n---\n\n# Page 6\n\n" +
    "<!-- vocabulary-exempt:start legacy -->\n" +
    "Every identity is `id`, never `_id`.\n" +
    "<!-- vocabulary-exempt:end -->\n",
  ["docs/page-6.mdx", "substantive reason"],
);

await mutation(
  "exemption around clean prose",
  root,
  "docs/page-7.mdx",
  "---\ntitle: Page 7\norder: 7\n---\n\n# Page 7\n\n" +
    "<!-- vocabulary-exempt:start this reason is long enough to be substantive -->\n" +
    "Nothing forbidden lives in here at all.\n" +
    "<!-- vocabulary-exempt:end -->\n",
  ["docs/page-7.mdx", "exempts nothing"],
);

await mutation(
  "unclosed exemption block",
  root,
  "docs/page-8.mdx",
  "---\ntitle: Page 8\norder: 8\n---\n\n# Page 8\n\n" +
    "<!-- vocabulary-exempt:start this reason is long enough to be substantive -->\n" +
    "Every identity is `id`, never `_id`.\n",
  ["docs/page-8.mdx", "never closed"],
);

// ── 3. Links ───────────────────────────────────────────────────────────────
await mutation(
  "broken internal link",
  root,
  "docs/page-9.mdx",
  "---\ntitle: Page 9\norder: 9\n---\n\n# Page 9\n\nSee [the routes](./routes-that-do-not-exist).\n",
  ["docs/page-9.mdx", "routes-that-do-not-exist"],
);

{
  // Working link forms must all pass: a file path, an extension-less docs slug,
  // an anchor, and an external URL. Without this the previous case could be
  // passing because the checker rejects every link.
  ran += 1;
  await write(
    root,
    "docs/page-10.mdx",
    "---\ntitle: Page 10\norder: 10\n---\n\n# Page 10\n\n" +
      "[slug](./routes) [file](../README.md) [anchor](#page-10) [ext](https://example.com) [index](./adr/README)\n",
  );
  commit(root);
  const result = run(root);
  if (result.exitCode !== 0) {
    failures.push(`valid link forms were rejected:\n${result.output}`);
  }
  await write(root, "docs/page-10.mdx", "---\ntitle: Page 10\norder: 10\n---\n\n# Page 10\n");
  commit(root);
}

{
  // A regex inside a fenced code block is NOT a link. This is not hypothetical:
  // the documented `perl -0777` route-extraction one-liner contains
  // `["\x27]([^"\x27]*)["\x27]`, which is `[…](…)` to a link regex, and it
  // failed the build on correct prose the first time the gate ran over it.
  //
  // Paired with a REAL broken link outside the fence in the same file, so this
  // case cannot pass by the checker having stopped looking at the file at all.
  ran += 1;
  await write(
    root,
    "docs/page-11.mdx",
    "---\ntitle: Page 11\norder: 11\n---\n\n# Page 11\n\n" +
      "```bash\nperl -0777 -ne 'while (/router\\.use\\(\\s*[\"\\x27]([^\"\\x27]*)[\"\\x27]/gs)' f.ts\n```\n\n" +
      "And a real one: [routes](./routes).\n",
  );
  commit(root);
  const fenced = run(root);
  if (fenced.exitCode !== 0) {
    failures.push(`a regex inside a code fence was treated as a link:\n${fenced.output}`);
  }

  await write(
    root,
    "docs/page-11.mdx",
    "---\ntitle: Page 11\norder: 11\n---\n\n# Page 11\n\n" +
      "```bash\nperl -0777 -ne 'while (/[\"\\x27]([^\"\\x27]*)[\"\\x27]/gs)' f.ts\n```\n\n" +
      "And a broken one: [gone](./page-that-does-not-exist).\n",
  );
  commit(root);
  const outside = run(root);
  if (outside.exitCode === 0 || !outside.output.includes("page-that-does-not-exist")) {
    failures.push(
      `stripping code fences also blinded the checker to a real broken link:\n${outside.output}`,
    );
  }
  await write(root, "docs/page-11.mdx", "---\ntitle: Page 11\norder: 11\n---\n\n# Page 11\n");
  commit(root);
}

// ── 4. Route drift ─────────────────────────────────────────────────────────
{
  const routesDoc = await readFile(join(root, "docs/routes.mdx"), "utf8");
  await mutation(
    "a mounted router missing from the routes doc",
    root,
    "docs/routes.mdx",
    routesDoc.replace("- `/api/evictions`\n", ""),
    ["/api/evictions"],
  );
  await mutation(
    "a frontend segment missing from the routes doc",
    root,
    "docs/routes.mdx",
    routesDoc.replace("- `roommates`\n", ""),
    ["roommates"],
  );
}

// ── 5. Vacuity ─────────────────────────────────────────────────────────────
// The floors are the defence against a broken enumeration reading as clean. If
// removing most of the docs still passes, every case above proves nothing.
{
  ran += 1;
  const removed = [];
  for (let i = 0; i < 14; i += 1) {
    const path = `docs/page-${i}.mdx`;
    const contents = await readFile(join(root, path), "utf8").catch(() => null);
    if (contents === null) continue;
    removed.push([path, contents]);
    await rm(join(root, path));
  }
  commit(root);
  const result = run(root);
  if (result.exitCode === 0) {
    failures.push("removing 14 of the scanned pages still passed — the scanned-file floor is not load-bearing");
  } else if (!result.output.includes("SCANNED_GLOBS")) {
    failures.push(`floor fired but did not explain itself:\n${result.output}`);
  }
  for (const [path, contents] of removed) await write(root, path, contents);
  commit(root);
}

{
  ran += 1;
  const routerFile = await readFile(join(root, "packages/backend/routes/index.ts"), "utf8");
  await write(
    root,
    "packages/backend/routes/index.ts",
    "import express from 'express';\nexport default function () { return express.Router(); }\n",
  );
  commit(root);
  const result = run(root);
  if (result.exitCode === 0) {
    failures.push("emptying routes/index.ts still passed — the mounted-router floor is not load-bearing");
  } else if (!result.output.includes("extraction is broken")) {
    failures.push(`router floor fired but did not explain itself:\n${result.output}`);
  }
  await write(root, "packages/backend/routes/index.ts", routerFile);
  commit(root);
}

// ── 6. Final control ───────────────────────────────────────────────────────
{
  const final = run(root);
  expect("final state is green", final.exitCode === 0, `fixture did not return to green:\n${final.output}`);
}

for (const path of created) await rm(path, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`check-docs.mjs mutation tests FAILED (${failures.length} of ${ran}):\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}

console.log(`check-docs.mjs mutation tests passed (${ran} assertions).`);
