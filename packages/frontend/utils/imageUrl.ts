import { API_URL } from '@/config';

/**
 * Re-home a backend-served image URL onto the active platform's API origin.
 *
 * WHY THIS EXISTS
 * ---------------
 * Our backend bakes the *request host* into the absolute URLs it stores for the
 * images it serves from its own `/api/images/...` route. In development that
 * request host is whatever the uploading client reached it as — most often the
 * Android emulator's special host alias `10.0.2.2`, or `localhost`. So a stored
 * URL looks like:
 *
 *   http://10.0.2.2:4005/api/images/file/property/<uuid>-medium.webp
 *
 * `10.0.2.2` is the emulator's alias for the host machine's loopback. It is
 * reachable from the emulator (native) but is meaningless to a web browser, a
 * physical device, or production — so those images silently fail to load on web.
 *
 * The proper root fix is backend-side (store host-agnostic relative
 * `/api/images/...` paths and never bake the request host). Until that lands,
 * this frontend helper makes our own backend image URLs robust regardless of
 * which host got baked in: when a stored URL is an absolute http(s) URL that
 * points at a dev/loopback host AND at our backend image route, we swap its
 * ORIGIN (scheme + host + port) for the origin of the current {@link API_URL}.
 * The path/query are preserved verbatim. Every other URL — external/scraped/CDN
 * absolute URLs, and relative paths — is returned untouched.
 *
 * Implementation note: we match with a REGEX rather than `new URL()` because the
 * React Native `URL` polyfill is not guaranteed to be present/complete.
 */

/**
 * Matches the ORIGIN (scheme + dev/loopback host + optional port) at the start
 * of an absolute http(s) URL. Only dev/loopback hosts are eligible — a real
 * external/CDN host never matches, so those URLs are left alone.
 *
 * Capture group 1 is the full origin, so we can detect it and (when the rest of
 * the URL is one of our backend image paths) replace exactly that prefix.
 */
const DEV_ORIGIN_RE = /^(https?:\/\/(?:10\.0\.2\.2|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?)/i;

/**
 * The path segment that identifies a URL as being served by our backend's image
 * route. We only re-home URLs whose remainder (after the origin) points here, so
 * a dev-hosted URL that is NOT one of our images is left untouched.
 */
const BACKEND_IMAGE_PATH = '/api/images';

/**
 * `API_URL` is an origin like `http://192.168.1.20:4000` (no trailing slash in
 * practice, but strip one defensively so we never produce `//api/images`).
 */
const API_ORIGIN = API_URL.replace(/\/+$/, '');

/**
 * Re-home a single backend image URL onto the active {@link API_URL} origin.
 *
 * @param url - A stored image URL (may be absolute or relative; may point at our
 *   backend, an external host, or be empty).
 * @returns The same URL with its dev/loopback origin swapped for the current API
 *   origin **only when** it is an absolute dev-host URL pointing at our backend
 *   image route. All other inputs (external/CDN URLs, relative paths, empty
 *   strings) are returned unchanged.
 */
export function resolveBackendImageUrl(url: string): string {
  const match = DEV_ORIGIN_RE.exec(url);
  if (!match) return url;

  const origin = match[1];
  const remainder = url.slice(origin.length);

  // Only re-home URLs that are actually served by our backend image route. A
  // dev-hosted URL pointing elsewhere is left alone.
  if (!remainder.startsWith(BACKEND_IMAGE_PATH)) return url;

  return `${API_ORIGIN}${remainder}`;
}
