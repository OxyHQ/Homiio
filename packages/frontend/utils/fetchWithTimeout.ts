/**
 * `fetch` with a total deadline (connect, headers and body). A bare `fetch`
 * never gives up, so a stalled connection leaves a screen on its spinner
 * forever. For small JSON requests to third parties and same-origin assets;
 * not for uploads or large downloads. A caller's own `signal` still aborts it.
 *
 * `AbortSignal.timeout` is not available on every Hermes build, hence the
 * controller and timer.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  else
    callerSignal?.addEventListener('abort', () => controller.abort(callerSignal.reason), {
      once: true,
    });
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  (timer as { unref?: () => void }).unref?.();
  return fetch(input, { ...init, signal: controller.signal });
}
