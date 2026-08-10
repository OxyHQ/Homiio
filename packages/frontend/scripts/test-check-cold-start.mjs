#!/usr/bin/env node
/**
 * Mutation-tests check-cold-start.mjs against deliberately broken exports.
 *
 * The failure that costs something is the check PASSING on an app that did not
 * boot, because then it reads as boot coverage forever and nobody looks again.
 * So this breaks the thing it guards and requires the check to notice — twice
 * over, because there are two distinct ways not to boot and they present
 * completely differently:
 *
 *  1. **Nothing mounts.** The entry bundle throws, the page stays empty, and
 *     the check must say the app rendered nothing.
 *  2. **Something mounts and a component crashed.** A React error boundary
 *     catches it, renders "Something went wrong", and logs to `console.error`.
 *     There is NO uncaught exception and there IS content — so every condition
 *     the check had before this case was added passed happily. Measured on
 *     `/explore` 2026-08-10: 33 elements, a visible error message, exit 0.
 *
 * Case 2 is the one worth having. It reproduces the failure through the same
 * channel the real bug used — a `console.error` during boot with no
 * `Runtime.exceptionThrown` — which is precisely what makes an error boundary
 * invisible to a content assertion. What it does not do is re-derive a React
 * render crash from a minified bundle; the observable is the console call, and
 * that is what the gate reads.
 *
 * Every case asserts the clean export FIRST, because a check that failed on
 * every input would satisfy the non-zero half on its own.
 *
 * Note this deliberately reads the FULL output and the exit code rather than
 * grepping for a pattern: an empty match is indistinguishable from a pass, which
 * is the mistake this whole family of scripts exists to avoid.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  rmSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, 'check-cold-start.mjs');
const DIST = join(HERE, '..', 'dist');

if (!existsSync(DIST)) {
  console.error('No export to test against. Run `bun run build` in packages/frontend first.');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'homiio-cold-start-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

let failures = 0;

/**
 * Runs the check and returns { status, output }.
 *
 * `spawnSync` rather than `execFileSync` on purpose: the verdict lines go to
 * STDERR (data on stdout, human verdict on stderr), and execFileSync returns
 * only stdout on success — so the clean case looked like a check that had
 * printed no verdict at all. Both streams, both outcomes, uniformly.
 */
function run(distDir) {
  const result = spawnSync('node', [CHECK, '/'], {
    encoding: 'utf8',
    env: { ...process.env, COLD_START_DIST: distDir, COLD_START_WAIT_MS: '9000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function expect(label, got, wantStatus, wantSubstring) {
  if (got.status !== wantStatus) {
    console.error(`FAIL ${label}: expected exit ${wantStatus}, got ${got.status}\n${got.output}`);
    failures += 1;
    return;
  }
  if (wantSubstring && !got.output.includes(wantSubstring)) {
    console.error(
      `FAIL ${label}: exit ${got.status} was right but the output never said ${JSON.stringify(wantSubstring)}\n${got.output}`,
    );
    failures += 1;
    return;
  }
  console.log(`ok   ${label}`);
}

// 1. The clean export must PASS — otherwise "it fails on the mutant" proves nothing.
expect('a working export passes', run(DIST), 0, 'PASS /');

// 2. A broken entry bundle must FAIL, and say the app rendered nothing.
const broken = join(work, 'dist-broken');
cpSync(DIST, broken, { recursive: true });
const jsDir = join(broken, '_expo', 'static', 'js', 'web');
const entry = readdirSync(jsDir).find((f) => f.startsWith('entry-') && f.endsWith('.js'));
if (!entry) {
  console.error('FAIL: could not find the entry bundle to break — the check cannot pass vacuously');
  process.exit(1);
}
writeFileSync(join(jsDir, entry), 'throw new Error("mutation probe: entry bundle broken");\n');
expect('a broken bundle is caught and named', run(broken), 1, 'rendered nothing');

// 3. A CAUGHT crash must FAIL too, even though the app renders.
//
// This is the case an error boundary hides. The app mounts normally and the
// only trace is a `console.error` — no uncaught exception — so before this
// condition existed the check reported PASS on a page whose whole content was
// "Something went wrong".
//
// The probe goes in `index.html` rather than in a bundle: it has to fire
// WITHOUT producing an uncaught exception, which is the property that made the
// real bug invisible. A `throw` anywhere would be caught by
// `Runtime.exceptionThrown` and hit the previous condition instead, proving
// nothing about this one. The message is React-shaped so the failure output is
// recognisable as the thing it stands in for.
const caught = join(work, 'dist-caught-crash');
cpSync(DIST, caught, { recursive: true });
const indexHtml = join(caught, 'index.html');
const CONSOLE_PROBE =
  '<script>console.error("Error: Minified React error #185; ' +
  'mutation probe: a component crashed and an error boundary caught it");</script>';
writeFileSync(
  indexHtml,
  readFileSync(indexHtml, 'utf8').replace('</head>', `${CONSOLE_PROBE}</head>`),
);
expect('a caught crash is caught, despite the app rendering', run(caught), 1, 'logged 1 error(s)');

if (failures) {
  console.error(`\n${failures} mutation(s) went undetected.`);
  process.exit(1);
}
console.log('\nAll mutations detected.');
