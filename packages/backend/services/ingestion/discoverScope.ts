/**
 * How much one discover pass is allowed to enqueue.
 *
 * `DiscoverJob.limit` is optional and providers read an absent one as
 * `Infinity`, and the worker's boot scopes set none — so a single scope
 * enumerated its portal to the end.
 *
 * **That is how a listing queue took down six unrelated services.** On
 * 2026-09-21, hours after the fleet went from 13 providers to 55, one
 * newly-enabled provider enqueued 20,519 fetch jobs in ONE pass. Redis went
 * from 79% to 100%, started refusing writes, and logged 1.6 million
 * `OOM command not allowed` errors across allo, clarity, moovo, noted, syra,
 * oxy-api and alia.
 *
 * Moving Homiio's queues to the dedicated node was the first fix, and it does
 * not address this. A burst that fills one node fills the other: the dedicated
 * node is the same instance class and sat at 82.8% the following day. The SIZE
 * of the burst is the defect, not its address — worth stating plainly, because
 * the obvious reading of that incident is "wrong node" and that reading is
 * incomplete.
 *
 * Depth is not lost, only spread. A scope runs again every cycle and the fetch
 * queue dedupes on `(provider, sourceId)`, so a portal with 20,000 listings is
 * collected across passes rather than in one breath — the same argument the
 * discover time budget makes, applied to memory instead of to the clock.
 *
 * This lives in its own module rather than inside `worker.ts` for a reason that
 * is not style: importing `worker.ts` starts a worker process, so anything
 * defined there can only be tested by RE-TYPING it in the test file. A test
 * that copies the implementation passes whatever the implementation does.
 */

/** The cap applied when the environment says nothing, and the floor for junk input. */
export const DEFAULT_DISCOVER_SCOPE_LIMIT = 250;

/**
 * Most refs one discover scope may enqueue in a pass.
 *
 * Reads `LISTING_DISCOVER_SCOPE_LIMIT`. `0` is an explicit opt-out meaning "no
 * cap" (`undefined`, the pre-incident behaviour) rather than "enqueue nothing",
 * because a variable someone sets to zero to disable a limit must not silently
 * disable the whole pipeline. Anything that is not a whole non-negative number
 * falls back to the default instead of throwing: this is edited by hand in a
 * task definition, and a typo must not stop the worker booting.
 */
export function discoverScopeLimit(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.LISTING_DISCOVER_SCOPE_LIMIT?.trim();
  if (!raw) return DEFAULT_DISCOVER_SCOPE_LIMIT;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return DEFAULT_DISCOVER_SCOPE_LIMIT;
  return parsed === 0 ? undefined : parsed;
}
