#!/usr/bin/env node
/**
 * Cold-start check: does the exported web app actually RENDER on a fresh load?
 *
 * Usage:
 *   bun run --cwd packages/frontend build     # produces dist/
 *   bun run --cwd packages/frontend check:cold-start [route ...]
 *
 * WHY THIS EXISTS
 *
 * Nothing else in this repository can see a white-screen boot. `tsc` passes,
 * `jest` passes, `expo export` succeeds — and the app still mounts nothing.
 * The failure mode it guards is real and has shipped in this ecosystem before:
 * a boot-mounted component calling a suspenseful hook deadlocks the render, so
 * the init effect never runs, the promise never resolves, and you get a blank
 * page with ZERO console output. Provider ordering (`~/Oxy/AGENTS.md`, the
 * `useTheme`/`BloomThemeProvider` rule) fails the same silent way.
 *
 * Run it after touching anything in the boot path: `app/_layout.tsx`, the
 * providers under `context/`, or the readiness/splash gate.
 *
 * WHAT IT ASSERTS, AND WHY EACH PART IS THERE
 *
 *  - A REAL browser, headed, on a real display — not jsdom. Jest reproduces
 *    neither render races, navigation races nor layout.
 *  - A FRESH `--user-data-dir` every run, so it is genuinely cold: no cache, no
 *    storage, no service worker carried over from the previous run.
 *  - `document.visibilityState === 'visible'` BEFORE any verdict. A backgrounded
 *    tab pauses `requestAnimationFrame`, which presents exactly as "blank" — a
 *    false reading that has cost this ecosystem a whole debugging session. If
 *    the tab is not foregrounded this exits INCONCLUSIVE (3) rather than
 *    passing or failing, because a blank reading would mean nothing.
 *  - Content, not merely absence of errors. "Nothing threw" is not the property;
 *    "the app rendered something" is.
 *
 * A STANDING RULE FOR CHANGING THIS FILE
 *
 * When you check its output, print the FULL output and the exit code. Do not
 * ask a grep whether it matched: an empty match reads identically to a pass,
 * and that mistake was made three separate times while building this. The
 * accompanying `test-check-cold-start.mjs` mutation-tests exactly that — it
 * breaks the bundle and requires this script to notice.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = process.env.COLD_START_DIST ?? join(HERE, '..', 'dist');
const ROUTES = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BOOT_WAIT_MS = Number(process.env.COLD_START_WAIT_MS ?? 9000);
const CHROME = process.env.COLD_START_CHROME ?? '/usr/bin/chromium';

/** Below this many DOM nodes we call it blank; a mounted app is far above it. */
const MIN_ELEMENTS = 20;

if (!existsSync(DIST)) {
  console.error(`No export at ${DIST}. Run \`bun run build\` in packages/frontend first.`);
  process.exit(2);
}
if (!existsSync(CHROME)) {
  console.error(`No browser at ${CHROME}. Set COLD_START_CHROME to one.`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const teardown = [];
function cleanup() {
  for (const fn of teardown.splice(0).reverse()) {
    try {
      fn();
    } catch {
      // Teardown is best effort; a failure here must not mask the verdict.
    }
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

const port = 8700 + Math.floor(Math.random() * 300);
const debugPort = 9400 + Math.floor(Math.random() * 400);

const server = spawn('bunx', ['--bun', 'serve', '-s', DIST, '-l', String(port)], {
  stdio: ['ignore', 'ignore', 'ignore'],
});
teardown.push(() => server.kill('SIGKILL'));

async function waitFor(fn, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  return null;
}

if (!(await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/`)).ok))) {
  console.error('static server never came up');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'homiio-cold-start-'));
teardown.push(() => rmSync(profile, { recursive: true, force: true }));

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);
teardown.push(() => chrome.kill('SIGKILL'));

const wsUrl = await waitFor(async () => {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
  return (await res.json()).webSocketDebuggerUrl;
});
if (!wsUrl) {
  console.error('browser devtools never came up');
  process.exit(2);
}

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
teardown.push(() => ws.close());

let nextId = 1;
const pending = new Map();
let consoleErrors = [];
let pageErrors = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(
      msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
    );
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const details = msg.params.exceptionDetails;
    pageErrors.push(details.exception?.description ?? details.text);
  }
};

function send(method, params = {}, sessionId) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const { targetInfos } = await send('Target.getTargets');
const pageTarget = targetInfos.find((t) => t.type === 'page');
const { sessionId } = await send('Target.attachToTarget', {
  targetId: pageTarget.targetId,
  flatten: true,
});
const call = (method, params = {}) => send(method, params, sessionId);
await call('Page.enable');
await call('Runtime.enable');

const PROBE = `(() => {
  const root = document.getElementById('root') || document.body;
  const text = (root.innerText || '').trim();
  return {
    visibility: document.visibilityState,
    rootChildren: root.childElementCount,
    elements: root.querySelectorAll('*').length,
    renderedChars: text.length,
    sample: text.slice(0, 120),
  };
})()`;

let failures = 0;
let inconclusive = 0;

for (const route of ROUTES.length ? ROUTES : ['/']) {
  consoleErrors = [];
  pageErrors = [];
  await call('Page.navigate', { url: `http://127.0.0.1:${port}${route}` });
  await sleep(BOOT_WAIT_MS);

  const { result } = await call('Runtime.evaluate', {
    expression: PROBE,
    returnByValue: true,
    awaitPromise: true,
  });
  const probe = result.value;

  console.log(JSON.stringify({ route, ...probe, consoleErrors, pageErrors }, null, 2));

  if (probe.visibility !== 'visible') {
    console.error(`INCONCLUSIVE ${route}: tab was not foregrounded, so "blank" would mean nothing.`);
    inconclusive += 1;
  } else if (probe.rootChildren === 0 || probe.elements < MIN_ELEMENTS) {
    console.error(`FAIL ${route}: the app rendered nothing (${probe.elements} elements).`);
    failures += 1;
  } else if (pageErrors.length) {
    console.error(`FAIL ${route}: uncaught exception during boot.`);
    failures += 1;
  } else {
    console.error(`PASS ${route}: ${probe.elements} elements, visibility=${probe.visibility}.`);
  }
}

cleanup();
if (inconclusive) process.exit(3);
process.exit(failures ? 1 : 0);
