/**
 * `GET /api/geo/approximate-location` — the first-party, permissionless answer
 * to "roughly where is this person?" (#518 §4, #519 §4).
 *
 * ## Why this is its own contract and not a `GeoPlace`
 *
 * A `GeoPlace` says WHAT a place is. This says what a place is AND how
 * confidently we came to name it, which is a different fact with different
 * rules attached. Three of those rules are only expressible here:
 *
 *  - **The inference source is not the place source.** `source: 'ip'` records
 *    how Homiio guessed; {@link PlaceSource} records which authority owns the
 *    entity that guess landed on. Collapsing them would make `PlaceSource` mean
 *    two things, and the first screen that reads `kind: 'homiio'` as "the user
 *    confirmed this" would be wrong.
 *  - **Unavailable is a first-class answer with a reason.** An IP lookup fails
 *    for five distinguishable reasons and the correct behaviour differs: a
 *    private address is normal in development, a provider timeout is worth
 *    retrying, and an unconfigured deployment is an operator's problem and not
 *    the user's. A `null` collapses all five into "no".
 *  - **The answer expires.** A network's location is a guess with a shelf life,
 *    and a client that caches it forever will scope somebody's Home to the
 *    airport they connected from last month.
 *
 * ## What this may never carry
 *
 * The IP itself, the provider's raw payload, a credential, a confidence number
 * the provider did not publish, or a `current_location` selection. An IP is not
 * a position: it can be a VPN exit, a carrier NAT or a satellite gateway, and
 * ADR 0002 §8.1 reserves `exact`/`approximate` precision for a point somebody's
 * device actually produced. Every selection this contract can carry is a
 * `place` at `centroid` or `area` precision — a framing device, explicitly not
 * anybody's location.
 *
 * ## Why the selection is always Homiio-owned
 *
 * {@link ApproximateLocationResolved.selection} names a country, region or city
 * that already exists in Homiio's geo tables. A provider's own city id would
 * serialise to a `loc` token naming a provider the geo gateway cannot resolve
 * (`services/geocoding/registry.ts` knows nothing about a GeoIP database), so
 * the scope would be unqueryable the moment Home tried to use it — a location
 * that looks resolved and silently searches nothing. Matching to a row Homiio
 * owns is what makes the answer USABLE rather than merely displayable, and the
 * resolver never creates one to make a match: an unmatchable address is
 * `unavailable`, which the client handles.
 */

import type { AdminHierarchy, LocationSelection } from './location';

/**
 * Why no approximate area could be produced.
 *
 * Each value maps to a different correct behaviour, which is why they are five
 * values and not one. None of them names the address, the provider's response
 * or a credential — an error body is one of the easiest places for an IP to
 * leak, and these strings are returned to an unauthenticated caller.
 */
export type ApproximateLocationUnavailableReason =
  /** No GeoIP database is configured in this deployment. An operator's problem. */
  | 'not_configured'
  /** The request carries no client address the server is willing to trust. */
  | 'no_client_ip'
  /** Loopback, private or otherwise reserved. Normal on a LAN; nothing to look up. */
  | 'private_address'
  /** The database was asked and holds no location for this address. */
  | 'no_match'
  /**
   * The address resolved to a place Homiio's geo tables do not contain.
   *
   * DISTINCT from `no_match` because the two are fixed differently: this one is
   * closed by importing the country/region/city, that one cannot be closed at
   * all. Conflating them would hide a coverage gap behind a provider gap.
   */
  | 'no_homiio_place'
  /** The lookup failed or ran out of time. Retryable. */
  | 'provider_error';

/** How precise the inference actually turned out to be. Never widened. */
export type ApproximateLocationGranularity = 'city' | 'region' | 'country';

export interface ApproximateLocationResolved {
  readonly status: 'resolved';
  /**
   * How the inference was made — NOT the place's authority.
   *
   * A literal union of one today, written as a union so that a second
   * permissionless source (an edge header from a trusted ingress, say) can be
   * added without every consumer's exhaustiveness check silently passing.
   */
  readonly source: 'ip';
  /**
   * What was actually resolved: a city, a region or only a country.
   *
   * Carried explicitly rather than inferred from `selection.placeType` so a
   * surface can say "Spain · approximate area" without reaching into the
   * selection's variant, and so the honest-scope rule — never name a city we
   * did not resolve — is one field to assert in a test.
   */
  readonly granularity: ApproximateLocationGranularity;
  /**
   * The scope to query. Always `kind: 'place'`, always Homiio-owned.
   *
   * Typed as the full union because that is what every consumer accepts; the
   * narrowing is enforced by the resolver and its tests rather than by a type
   * that would have to restate half of {@link LocationSelection}.
   */
  readonly selection: LocationSelection;
  /** The administrative hierarchy, for labels that must not guess a parent. */
  readonly admin: AdminHierarchy;
  /** When the server resolved it. ISO-8601. */
  readonly resolvedAt: string;
  /** After this, a client must ask again rather than keep scoping to it. ISO-8601. */
  readonly expiresAt: string;
  /**
   * The provider's own published accuracy radius, in kilometres.
   *
   * ABSENT unless the provider documents one with a defined meaning. Homiio
   * never computes it: a radius invented to fill a field would be a confidence
   * claim nobody measured, and MaxMind's own guidance is explicit that an IP
   * yields an uncertain area rather than a point.
   */
  readonly accuracyRadiusKm?: number;
}

export interface ApproximateLocationUnavailable {
  readonly status: 'unavailable';
  readonly source: 'ip';
  readonly reason: ApproximateLocationUnavailableReason;
  readonly resolvedAt: string;
}

/**
 * The endpoint's payload: resolved, or unavailable with a reason.
 *
 * A discriminated union rather than an optional selection, so "we have an area"
 * and "we do not" cannot both be half-true — the shape that lets a caller read
 * `data.selection` without checking and scope a search to `undefined`.
 */
export type ApproximateLocation = ApproximateLocationResolved | ApproximateLocationUnavailable;

/**
 * How long a resolved answer may be reused, in milliseconds.
 *
 * Shared by the server (which stamps `expiresAt`) and the client (which sizes
 * its in-memory cache), because two numbers that must agree and live in two
 * packages are two numbers that will stop agreeing.
 *
 * Thirty minutes: long enough that navigating the app does not re-ask, short
 * enough that moving networks — leaving home, joining a VPN — is noticed within
 * one session rather than at the next cold start.
 */
export const APPROXIMATE_LOCATION_TTL_MS = 30 * 60 * 1000;
