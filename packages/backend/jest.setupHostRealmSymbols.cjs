/**
 * Give jest's sandbox the host realm's `Symbol.dispose` / `Symbol.asyncDispose`.
 *
 * WHY: on Node 22 these two are not V8 well-known symbols. Node defines them on
 * ITS OWN realm's `Symbol` (`Symbol(nodejs.dispose)`), and jest runs every test
 * file in a separate vm realm whose `Symbol` has neither. Host modules still
 * hand out objects keyed by the host symbol: `events.addAbortListener` returns
 * `{ [Symbol(nodejs.dispose)]() {} }`. undici's fetch, loaded inside the
 * sandbox, reads that with the sandbox's `Symbol.dispose` — `undefined` — and
 * every request through a real ProxyAgent ends in
 * `TypeError: removeAbortListener is not a function`
 * (undici/lib/web/fetch/index.js, cleanupAbortListeners).
 *
 * Measured 2026-10-12 with CI's Node 22.23.3: the sandbox's Symbol.dispose is
 * undefined and the host's is Symbol(nodejs.dispose), while the same undici on
 * plain Node 22 (no jest) classifies 402/407/503 correctly. Node 24 ships them as
 * real well-known symbols shared by every realm, so there this is a no-op.
 *
 * This makes the sandbox match the realm the worker actually runs in; it does
 * not stub undici or change what proxyHealthCheck.test.ts exercises.
 */
const { addAbortListener } = require('node:events');
const { runInThisContext } = require('node:vm');

for (const name of ['dispose', 'asyncDispose']) {
  if (typeof Symbol[name] === 'symbol') continue;
  // Evaluated in Node's main context, so this is the host realm's symbol.
  const hostSymbol = runInThisContext(`Symbol.${name}`);
  if (typeof hostSymbol !== 'symbol') continue;
  Object.defineProperty(Symbol, name, {
    value: hostSymbol,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

// The symbol undici reads must be the one host disposables are keyed by; fail the
// whole run loudly rather than let a mismatch resurface as a TypeError in a test.
const disposable = addAbortListener(new AbortController().signal, () => undefined);
if (typeof disposable[Symbol.dispose] !== 'function') {
  throw new Error(
    'jest.setupHostRealmSymbols.cjs: Symbol.dispose in the jest sandbox does not key events.addAbortListener disposables',
  );
}
disposable[Symbol.dispose]();
