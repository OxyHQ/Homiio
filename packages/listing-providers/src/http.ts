/**
 * Low-level, dependency-free HTTP helpers shared by the runtime and the fetch
 * strategies: an abort-based timeout wrapper, a cancellable sleep and a host
 * extractor. Kept separate so both {@link ./runtime} and {@link ./strategy} use
 * ONE implementation (no per-module duplication).
 */

/** Default per-request abort budget (ms). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Descriptive User-Agent so portals/CDNs can identify Homiio's ingest fetches. */
export const DEFAULT_USER_AGENT = 'Homiio-Listings/1.0 (+https://homiio.com)';

/** Chrome desktop UA used by the browser tier (less bot-like than the ingest UA). */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Raised when a cancellable {@link sleep} is aborted by its signal. */
export class AbortError extends Error {
  constructor(message = 'Aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

/**
 * Run an async operation with an abort-based timeout. Merges an optional
 * external signal so the caller can also cancel. Always clears the timer.
 */
export async function withAbortTimeout<T>(
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

/** Sleep for `ms`, rejecting early with {@link AbortError} if the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** The lowercased host of a URL, or the raw string when it cannot be parsed. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
}

/** Normalize an unknown thrown value to a message string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
