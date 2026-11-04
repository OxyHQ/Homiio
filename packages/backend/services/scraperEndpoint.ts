/**
 * Which feeds `POST /api/scraper/run` may fetch.
 *
 * The route takes an `endpoint` straight from the request body, and the process
 * runs inside the VPC, so an unbounded GET would reach the ECS task-metadata
 * endpoint (the task role's IAM credentials), IMDS and every internal service.
 * CodeQL has called it `js/request-forgery` (CRITICAL) since 2025-08-23. The
 * application permission on the route bounds WHO; two layers bound WHAT:
 *
 *  1. **This allowlist** — the origin must be one a deployment named. Without
 *     it any public host would do, turning the API into an open proxy.
 *  2. **`safeFetch`** (`@oxy.so/core/server`, in `scraperService.ts`) — every
 *     resolved address is checked and the socket is pinned to it, so a name
 *     that rebinds to an internal address is refused, and redirects are not
 *     followed (`maxRedirects: 0`): a redirect is the documented way past an
 *     origin allowlist.
 */

import { AppError } from '../middlewares/errorHandler';

/**
 * Origins the scraper may fetch from (`SCRAPER_ALLOWED_ORIGINS`, comma
 * separated, e.g. `https://feeds.example.com,https://partner.example.org`).
 *
 * **EMPTY MEANS NOTHING IS ALLOWED, and that is the intended default.** The
 * legacy scrape loop this route drove is retired (see `AGENTS.md`); what remains
 * is manual operator tooling that nothing runs on a schedule. A default of "any
 * host" is what made the finding critical; a default of "none" fails as a 400.
 */
export function scraperAllowedOrigins(): ReadonlySet<string> {
  const raw = process.env.SCRAPER_ALLOWED_ORIGINS ?? '';
  return new Set(
    raw
      .split(',')
      .map((entry) => normaliseOrigin(entry.trim()))
      .filter((origin): origin is string => origin !== undefined),
  );
}

/** `https://Host:443/x` -> `https://host` (default ports dropped, path ignored). */
function normaliseOrigin(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function refused(reason: string): AppError {
  return new AppError(`Scraper endpoint refused: ${reason}`, 400, 'SCRAPER_ENDPOINT_REFUSED');
}

/**
 * Check a caller-supplied endpoint against the allowlist.
 *
 * Returns the parsed URL so the caller fetches the SAME value that was
 * validated, rather than re-parsing the string and risking a different reading.
 */
export function assertAllowedScraperEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw refused('endpoint is not a valid absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw refused('only http and https endpoints are allowed');
  }
  // Credentials in the URL would be sent to whatever the host turns out to be,
  // and they are never part of a legitimate feed endpoint.
  if (url.username || url.password) throw refused('endpoint must not carry credentials');

  const allowed = scraperAllowedOrigins();
  if (allowed.size === 0) {
    throw refused('no scraper origins are configured; set SCRAPER_ALLOWED_ORIGINS to permit one');
  }
  if (!allowed.has(url.origin.toLowerCase())) throw refused('endpoint origin is not allow-listed');
  return url;
}
