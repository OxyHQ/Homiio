/**
 * The one privacy-preserving rate-limit key.
 *
 * Extracted from `server.ts` when the geo gateway needed a second, tighter
 * limiter: two limiters keying differently would mean two different privacy
 * postures, and the weaker one would be the one nobody reviewed.
 *
 * Authenticated requests key on the user id, which avoids the shared-IP
 * collision behind the ALB where many users leave from one egress address.
 *
 * Anonymous requests key on a salted, non-reversible HMAC of the NORMALIZED
 * client IP — the raw IP is never held at rest in the rate-limit store, which
 * is the standing mandate. `ipKeyGenerator` buckets IPv6 to its /56 subnet so a
 * single v6 host cannot rotate through its allocation to mint fresh keys; the
 * result is HMAC'd with `IP_HASH_SALT` and namespaced. Mirrors the semantics of
 * OxyHQServices' `packages/api/src/utils/ipKey.ts`. `req.ip` is read
 * transiently and discarded — it is never logged or persisted.
 */

import crypto from 'crypto';
import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

/**
 * @param namespace - Distinguishes one limiter's buckets from another's, so the
 *   geo budget and the global API budget cannot consume each other. Plays the
 *   same role as `rate-limit-redis`'s per-limiter `prefix`.
 */
export function rateLimitKeyFor(req: Request, namespace: string): string {
  const userId = req.user?.id || req.user?._id;
  if (userId) {
    return `${namespace}:user:${userId}`;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const normalized = ipKeyGenerator(ip);
  const salt = process.env.IP_HASH_SALT || '';
  return crypto
    .createHmac('sha256', salt)
    .update(`${namespace}|${normalized}`)
    .digest('hex')
    .slice(0, 24);
}
