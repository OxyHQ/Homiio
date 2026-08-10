/**
 * A guard that fails a suite which attempts an outbound request.
 *
 * ## Why a guard rather than a claim
 *
 * "This suite is hermetic" is exactly the shape of assertion this repository
 * keeps catching: true when written, never re-checked, and the run that
 * disproves it is a red CI on somebody else's PR blaming their change. A green
 * suite that quietly reaches a third party means something different on two
 * machines and in two different weeks.
 *
 * ## Rejecting is NOT enough, and that is the whole design
 *
 * The obvious guard replaces `fetch` with one that throws. It does not work
 * here, and the reason generalises: **the call sites that reach the network are
 * exactly the ones written to survive it failing.** `cityCoverSyncService`
 * wraps its Wikimedia search in `try { … } catch { logger.warn(…) }` — entirely
 * correct, since a cover is optional — so a throwing `fetch` is caught, logged,
 * and the suite passes. The guard would report nothing while appearing to
 * guard, which is worse than no guard.
 *
 * So every attempt is RECORDED, and `afterAll` asserts the record is empty. A
 * swallowed rejection still fails the suite, because the evidence does not live
 * in the exception. The rejection is kept as well, so no real request is made
 * and nothing waits on a timeout.
 *
 * ## It reports the URL, because the URL is the finding
 *
 * When this fires the useful information is not "something used the network" —
 * it is WHICH host, because that names the seam somebody has to stub.
 *
 * ## Scope, stated so nobody reads it as a sandbox
 *
 * It replaces the global `fetch`, which is what every outbound call in this
 * backend uses today. It does NOT intercept `node:http` directly, a socket
 * opened by a driver, or a native module. Postgres is deliberately unaffected:
 * the throwaway database is a real local server and is the one dependency these
 * suites are entitled to.
 */

/** The real `fetch`, captured once so a nested install cannot lose it. */
const realFetch: typeof globalThis.fetch = globalThis.fetch;

/** One attempted outbound request. */
export interface NetworkAttempt {
  readonly method: string;
  readonly url: string;
}

/** Best-effort method + URL for whatever shape the caller passed `fetch`. */
function describeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): NetworkAttempt {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (typeof input === 'string') return { method, url: input };
  if (input instanceof URL) return { method, url: input.toString() };
  if (input instanceof Request) return { method, url: input.url };
  return { method, url: String(input) };
}

/**
 * Fail this suite if it attempts any `fetch`, and restore the real one after.
 *
 * Call at the top level of a test file. Returns the live attempt list, so a test
 * can assert on it directly — which is how this helper's own guard-test proves
 * the recording works rather than trusting it.
 */
export function installNoNetworkGuard(suiteName: string): NetworkAttempt[] {
  const attempts: NetworkAttempt[] = [];

  beforeAll(() => {
    attempts.length = 0;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const attempt = describeRequest(input, init);
      attempts.push(attempt);
      return Promise.reject(
        new Error(`Outbound ${attempt.method} to ${attempt.url} blocked in ${suiteName}`),
      );
    }) as typeof globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;

    if (attempts.length > 0) {
      const listed = attempts.map(({ method, url }) => `  ${method} ${url}`).join('\n');
      throw new Error(
        `${suiteName} attempted ${attempts.length} outbound request(s):\n${listed}\n\n` +
          `This suite is required to be hermetic. Stub the seam that reaches the ` +
          `network — prefer the narrowest one (the module the code under test ` +
          `imports) over replacing fetch globally, which only hides the next call ` +
          `somebody adds. If a suite genuinely needs the real request, it belongs ` +
          `in a separate, clearly-labelled suite outside the default backend run.`,
      );
    }
  });

  return attempts;
}
