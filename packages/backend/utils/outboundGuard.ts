/**
 * Guards for outbound HTTP the CALLER chooses the destination of.
 *
 * `POST /api/scraper/run` takes an `endpoint` straight from the request body
 * and hands it to `axios.get`. CodeQL has called that `js/request-forgery`
 * (CRITICAL) since 2025-08-23. The route is behind `requireAdmin`, which is why
 * it survived — but **the guard bounds WHO, not WHAT**, and the backend runs in
 * ECS Fargate inside the VPC. An admin-supplied endpoint makes the API issue an
 * arbitrary GET from a position nothing on the internet has:
 *
 *   * `169.254.170.2/v2/credentials/…` — the task role's IAM credentials
 *   * `169.254.169.254/…`              — EC2/IMDS
 *   * `postgres.internal.oxy.so`, Valkey, every internal service
 *
 * App-admin becomes AWS-role, which is a bigger step than the privilege the
 * route was meant to grant.
 *
 * ## Why a string check is not enough, and what this does instead
 *
 * Validating the URL as text fails to two things that both apply here:
 *
 *  1. **Redirects.** axios follows up to five by default and the call site set
 *     no limit. An allowlisted host that answers `302 Location:
 *     http://169.254.170.2/…` wins against any check made before the request.
 *     {@link guardedRequestConfig} sets `maxRedirects: 0`.
 *
 *  2. **DNS rebinding.** `evil.example` can resolve to a public address when
 *     validated and to `169.254.170.2` when connected to, moments later. So the
 *     address check does not run against a resolved name up front — it runs
 *     inside the socket's own `lookup`, which is the last point before connect
 *     and leaves no window.
 *
 * Both layers are needed. The allowlist alone is defeated by rebinding; the
 * address check alone would permit any public host, turning the API into an
 * open proxy.
 */

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/** Raised when an outbound destination is refused. Never carries the target. */
export class BlockedOutboundRequestError extends Error {
  constructor(reason: string) {
    super(`Outbound request refused: ${reason}`);
    this.name = 'BlockedOutboundRequestError';
  }
}

/**
 * Origins the scraper may fetch from (`SCRAPER_ALLOWED_ORIGINS`, comma
 * separated, e.g. `https://feeds.example.com,https://partner.example.org`).
 *
 * **EMPTY MEANS NOTHING IS ALLOWED, and that is the intended default.** The
 * legacy scrape loop this route drove is retired (see `AGENTS.md`); what remains
 * is manual admin tooling that nothing runs on a schedule. A default of "any
 * host" is what made the finding critical, and a default of "none" fails in the
 * direction where the failure is a 400 rather than a leaked IAM role.
 */
export function scraperAllowedOrigins(): ReadonlySet<string> {
  const raw = process.env.SCRAPER_ALLOWED_ORIGINS ?? '';
  const origins = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normaliseOrigin)
    .filter((origin): origin is string => origin !== undefined);
  return new Set(origins);
}

/** `https://Host:443/x` -> `https://host` (default ports dropped, path ignored). */
function normaliseOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Check a caller-supplied endpoint against the allowlist.
 *
 * Returns the parsed URL so the caller uses the SAME value that was validated,
 * rather than re-parsing the string and risking a different interpretation.
 */
export function assertAllowedScraperEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BlockedOutboundRequestError('endpoint is not a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedOutboundRequestError('only http and https endpoints are allowed');
  }

  // Credentials in the URL would be sent to whatever the host turns out to be,
  // and they are never part of a legitimate feed endpoint.
  if (url.username || url.password) {
    throw new BlockedOutboundRequestError('endpoint must not carry credentials');
  }

  const allowed = scraperAllowedOrigins();
  if (allowed.size === 0) {
    throw new BlockedOutboundRequestError(
      'no scraper origins are configured; set SCRAPER_ALLOWED_ORIGINS to permit one',
    );
  }
  if (!allowed.has(url.origin.toLowerCase())) {
    throw new BlockedOutboundRequestError('endpoint origin is not allow-listed');
  }

  return url;
}

/**
 * Address ranges an outbound request from inside the VPC must never reach.
 *
 * The link-local block is the one that matters most — it holds both the ECS
 * task-metadata endpoint and IMDS — but private and loopback ranges are equally
 * off limits, since they are where every internal service lives.
 */
function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  // Not an IP literal: refuse rather than guess.
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local: ECS metadata + IMDS
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0];
  if (value === '::' || value === '::1') return true; // unspecified, loopback
  if (value.startsWith('fe8') || value.startsWith('fe9')) return true; // link-local
  if (value.startsWith('fea') || value.startsWith('feb')) return true; // link-local
  if (value.startsWith('fc') || value.startsWith('fd')) return true; // unique local
  if (value.startsWith('ff')) return true; // multicast

  // IPv4-mapped (`::ffff:169.254.170.2`) reaches the same interfaces.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

/**
 * A `dns.lookup` replacement that refuses to resolve to an internal address.
 *
 * Runs at CONNECT time, which is what closes the rebinding window: whatever the
 * name resolved to during validation, this is the address the socket is about
 * to use.
 */
const guardedLookup: typeof dns.lookup = ((
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void,
) => {
  const done = typeof options === 'function' ? (options as typeof callback) : callback;
  const lookupOptions = typeof options === 'function' ? {} : (options as dns.LookupOptions);

  dns.lookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
    if (error) return done(error);

    const resolved = Array.isArray(addresses) ? addresses : [];
    const permitted = resolved.find((entry) => !isBlockedAddress(entry.address));
    if (!permitted) {
      return done(
        Object.assign(new BlockedOutboundRequestError('endpoint resolves to an internal address'), {
          code: 'EACCES',
        }) as NodeJS.ErrnoException,
      );
    }

    if ((lookupOptions as dns.LookupOptions | undefined)?.all) {
      return done(null, [permitted] as unknown, permitted.family);
    }
    return done(null, permitted.address, permitted.family);
  });
}) as typeof dns.lookup;

/**
 * Request options that keep a caller-chosen destination from becoming an SSRF.
 *
 * Spread into the axios call. Two guarantees, and both are load-bearing:
 * redirects are refused outright, and every socket resolves through
 * {@link guardedLookup}.
 */
export function guardedRequestConfig(): {
  maxRedirects: number;
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
} {
  return {
    // Not "follow fewer" — follow NONE. A redirect is the documented way past
    // an origin allowlist, and a feed that needs one can be allow-listed at its
    // real origin instead.
    maxRedirects: 0,
    httpAgent: new http.Agent({ lookup: guardedLookup }),
    httpsAgent: new https.Agent({ lookup: guardedLookup }),
  };
}

/** Exported for tests; not part of the guard's public surface. */
export const __testing = { isBlockedAddress };
