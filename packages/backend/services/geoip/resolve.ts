/**
 * `ApproximateLocation`, assembled.
 *
 * The three parts are deliberately separate modules and joined only here:
 * `clientIp` decides WHICH address may be asked about, the provider decides
 * WHAT the address says, and `placeMatch` decides which Homiio row that
 * corresponds to. This file owns the one remaining decision — what the caller
 * is told — and it owns it alone so that every `unavailable` reason has exactly
 * one origin.
 *
 * ## Nothing here retains the address
 *
 * It arrives as an argument, goes to the provider, and is not stored, logged,
 * cached or keyed on. The in-process cache below is keyed on the NORMALISED
 * address, which is the one place it would be retained — see the note there for
 * why that is a deliberate, bounded exception and how it is bounded.
 */

import {
  APPROXIMATE_LOCATION_TTL_MS,
  geoPlaceToSelection,
  serializeLocationRef,
  type ApproximateLocation,
  type ApproximateLocationUnavailableReason,
} from '@homiio/shared-types';

import { resolvePlace } from '../geocoding/gateway';
import { clientAddressOf, type ClientAddressSource } from './clientIp';
import { matchHomiioPlace } from './placeMatch';
import { geoIpProvider } from './registry';

/**
 * How long a resolved answer is reused for the SAME network address.
 *
 * ## Why this cache exists at all, given it holds addresses
 *
 * Without it, every cold start of the app costs a database round trip for the
 * city match — and both epics forbid a per-widget fan-out, so Home, Explore and
 * the search bar all read one shared resolution. The cost saved is real.
 *
 * ## How it is bounded
 *
 * It is in-process memory, never Redis and never a table, so it dies with the
 * task and cannot be queried, exported or subpoenaed as a history. It holds the
 * address for at most the contract's TTL. It is capped, and eviction is by
 * insertion order, so a scan cannot grow it without bound. And it holds ONLY
 * the resolved area, which is a city — the same fact the response already gave
 * that caller.
 *
 * What it must never become: a persisted map of address → location. That is the
 * "historial persistente de IP" both epics name, and the type of this variable
 * is the only thing standing between the two. It stays a `Map` in this module.
 */
const CACHE_MAX_ENTRIES = 5_000;
const cache = new Map<string, { readonly value: ApproximateLocation; readonly expiresAtMs: number }>();

/** Test seam: forget every cached resolution. */
export function resetApproximateLocationCache(): void {
  cache.clear();
}

function unavailable(reason: ApproximateLocationUnavailableReason): ApproximateLocation {
  return { status: 'unavailable', source: 'ip', reason, resolvedAt: new Date().toISOString() };
}

function remember(key: string, value: ApproximateLocation): ApproximateLocation {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Insertion order: `Map` iterates it, so the oldest key is the first one.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { value, expiresAtMs: Date.now() + APPROXIMATE_LOCATION_TTL_MS });
  return value;
}

/**
 * Resolve the approximate area of whoever made this request.
 *
 * `language` selects the labels of the resolved place, exactly as the rest of
 * the geo gateway does; it does not affect which place is chosen.
 */
export async function resolveApproximateLocation(
  req: ClientAddressSource,
  language: string,
): Promise<ApproximateLocation> {
  const client = clientAddressOf(req);
  if (client.kind === 'absent') return unavailable('no_client_ip');
  if (client.kind === 'private') return unavailable('private_address');

  const key = `${client.address}|${language}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAtMs > Date.now()) return hit.value;
  if (hit) cache.delete(key);

  const outcome = await geoIpProvider().lookup(client.address);
  if (outcome.status === 'not_configured') return unavailable('not_configured');
  // NOT cached: a provider error is about this moment and caching it would
  // extend one blip into half an hour of neutral discovery for that network.
  if (outcome.status === 'error') return unavailable('provider_error');
  if (outcome.status === 'not_found') return remember(key, unavailable('no_match'));

  const match = await matchHomiioPlace(outcome.record);
  if (!match) return remember(key, unavailable('no_homiio_place'));

  const token = serializeLocationRef({
    kind: 'place',
    placeType: match.granularity,
    source: { kind: 'homiio' },
    id: match.id,
  });
  // Unreachable for a generated id — the grammar rejects only ids carrying its
  // separators — but a silent `unavailable` beats a throw on a public endpoint.
  if (!token.ok) return unavailable('no_homiio_place');

  const resolved = await resolvePlace(token.value, language);
  // `resolvePlace` answers null for a place it cannot FRAME: a country whose
  // cities carry no coordinates, say. Reported as a coverage gap rather than
  // pretended around, because a scope with no geometry queries nothing.
  if (!resolved.place) return remember(key, unavailable('no_homiio_place'));

  const now = Date.now();
  return remember(key, {
    status: 'resolved',
    source: 'ip',
    granularity: match.granularity,
    selection: geoPlaceToSelection(resolved.place),
    admin: resolved.place.admin,
    resolvedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + APPROXIMATE_LOCATION_TTL_MS).toISOString(),
    // Carried ONLY when the provider published one, and only when the answer is
    // actually about a city: a country-level scope with a 20 km radius beside it
    // would be a confidence claim about the wrong thing.
    ...(match.granularity === 'city' && typeof outcome.record.accuracyRadiusKm === 'number'
      ? { accuracyRadiusKm: outcome.record.accuracyRadiusKm }
      : {}),
  });
}
