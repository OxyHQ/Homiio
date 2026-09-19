/**
 * Which address a GeoIP lookup is allowed to be about.
 *
 * ## The rule, and why it is one line of code and forty of prose
 *
 * **Read `req.ip`. Never parse `X-Forwarded-For`.**
 *
 * `X-Forwarded-For` is client-controlled. Anybody can send
 * `X-Forwarded-For: 8.8.8.8` and, if a server believes the FIRST entry, relocate
 * themselves — or everybody, if the answer is ever cached across callers. The
 * temptation to reach for the header directly is strong precisely because the
 * correct expression looks like it is doing nothing.
 *
 * Express already does the work, given the topology. `server.ts` sets
 * `trust proxy: 1`, which is exactly right for `api.homiio.com`: the host rule
 * in `oxy-infra/terraform-uswest2/app-services.tf` points the shared ALB
 * listener straight at the ECS task, and `cdn.tf`'s CloudFront distribution
 * fronts only the media bucket — there is no CDN hop in front of the API. So
 * the chain is exactly `client → ALB → task`, one trusted hop.
 *
 * With one trusted hop, `proxy-addr` walks `[socket.remoteAddress, ...XFF
 * reversed]` and returns the first address it does not trust:
 *
 * | The client sends | ALB forwards | `req.ip` |
 * |---|---|---|
 * | nothing | `XFF: <client>` | `<client>` |
 * | `XFF: 8.8.8.8` | `XFF: 8.8.8.8, <client>` | `<client>` — the forgery is to the LEFT |
 * | `XFF: a, b, c` | `XFF: a, b, c, <client>` | `<client>` |
 *
 * The forged entries are always to the left of the address the ALB appended, and
 * `req.ip` is read from the right. That is the whole defence, and it is a
 * property of reading `req.ip` rather than of any check in this file — which is
 * why the file's job is to REFUSE the alternatives rather than to sanitise them.
 *
 * ## What this file does add
 *
 * Normalisation and classification. An address that is loopback, private,
 * carrier-grade NAT or otherwise reserved is not a place: looking it up returns
 * either nothing or, worse, the location of the infrastructure. A server-side
 * render or an internal health probe reaching this endpoint must NOT be handed
 * the datacentre's own city and must certainly not have it cached for everyone.
 *
 * ## What is never done with the address
 *
 * It is read transiently and discarded. It is not logged, not persisted, not
 * put in a cache key, and not returned to the caller in any form — the same
 * posture `middlewares/rateLimitKey.ts` takes, for the same reason.
 */

/** A client address that is worth asking a GeoIP database about. */
export interface PublicClientAddress {
  readonly kind: 'public';
  /** Normalised: no IPv4-mapped prefix, no zone id, no brackets, lowercase. */
  readonly address: string;
  readonly family: 'ipv4' | 'ipv6';
}

/** Why no address is available to look up. Mirrors the contract's reasons. */
export type ClientAddressRefusal =
  | { readonly kind: 'absent' }
  | { readonly kind: 'private' };

export type ClientAddress = PublicClientAddress | ClientAddressRefusal;

/** The subset of an Express request this module reads. Nothing else is touched. */
export interface ClientAddressSource {
  readonly ip?: string | undefined;
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined;
}

/**
 * Strip the wrappers an address picks up in transit.
 *
 * Four of them, and each has produced a real lookup failure somewhere:
 *
 *  - `::ffff:203.0.113.5` — an IPv4 client on a dual-stack socket. Every GeoIP
 *    database keys this as the v4 address; handed the v6 spelling it answers
 *    nothing, which looks exactly like an unknown address.
 *  - `[2001:db8::1]:443` — the bracketed host:port form.
 *  - `fe80::1%eth0` — a zone id, which is meaningful only on the local host.
 *  - surrounding whitespace, from a hand-assembled header.
 */
export function normalizeAddress(raw: string): string | null {
  let value = raw.trim();
  if (value === '') return null;

  // `[host]:port` and `[host]`.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1] !== undefined) value = bracketed[1];

  // A zone id is local to the sending host and never part of the identity.
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);

  value = value.toLowerCase();

  // IPv4-mapped and IPv4-compatible IPv6. Checked AFTER lowercasing so
  // `::FFFF:` matches too.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped?.[1] !== undefined) return mapped[1];

  // `1.2.3.4:5678` — an IPv4 address that kept its port. Only stripped when the
  // left side is a complete dotted quad, so an IPv6 address is never cut here.
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (v4WithPort?.[1] !== undefined) return v4WithPort[1];

  return value;
}

/** Parse a dotted quad into its four octets, or `null` when it is not one. */
function ipv4Octets(value: string): readonly number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/**
 * Whether an address belongs to a range that describes infrastructure rather
 * than a place.
 *
 * The list is deliberately WIDER than "private": carrier-grade NAT (100.64/10)
 * is a real client behind a mobile operator's translator, and the address itself
 * still locates nothing, so it is refused for the same reason. Being wrong in
 * this direction costs a neutral discovery surface; being wrong in the other
 * direction hands somebody the datacentre's city and calls it theirs.
 */
export function isReservedAddress(normalized: string): boolean {
  const v4 = ipv4Octets(normalized);
  if (v4) {
    const [a = 0, b = 0] = v4;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0) return true; // 192.0.0/24 IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast, reserved, broadcast
    return false;
  }

  if (normalized === '::' || normalized === '::1') return true;
  // Unique local fc00::/7 and link-local fe80::/10. Matched on the leading
  // hextet because an IPv6 address has many spellings and only the first group
  // carries these prefixes.
  if (/^f[cd]/.test(normalized)) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  // IPv4-mapped forms that survived normalisation only when malformed; treat
  // anything still carrying `::ffff:` as reserved rather than guessing.
  if (normalized.startsWith('::ffff:')) return true;
  return false;
}

/** Whether the normalised address is syntactically an address at all. */
function familyOf(normalized: string): 'ipv4' | 'ipv6' | null {
  if (ipv4Octets(normalized)) return 'ipv4';
  // Loose on purpose: the exact IPv6 grammar is the socket layer's business and
  // this value came from one. What matters is that it is not a hostname, a
  // sentinel like `unknown`, or an empty string.
  if (/^[0-9a-f:]+$/.test(normalized) && normalized.includes(':')) return 'ipv6';
  return null;
}

/**
 * The address a lookup may be about, or why there is none.
 *
 * `req.ip` first and `socket.remoteAddress` only as a fallback for a request
 * that never went through Express's proxy resolution (a direct connection in
 * development, or a unit test). The fallback can never WIDEN trust: a socket
 * peer is the actual TCP peer and carries no client-supplied data at all.
 */
export function clientAddressOf(req: ClientAddressSource): ClientAddress {
  const raw = req.ip ?? req.socket?.remoteAddress ?? '';
  const normalized = normalizeAddress(raw);
  if (normalized === null) return { kind: 'absent' };

  const family = familyOf(normalized);
  if (family === null) return { kind: 'absent' };

  if (isReservedAddress(normalized)) return { kind: 'private' };

  return { kind: 'public', address: normalized, family };
}
