/**
 * The GeoIP provider boundary.
 *
 * ONE interface, deliberately narrow: an address in, a normalised record or a
 * typed outcome out. Everything a provider knows that Homiio does not need —
 * ASN, ISP, postal code, the raw response — stops here, which is what keeps the
 * privacy posture a property of the boundary rather than of each caller's
 * discipline.
 *
 * `not_configured` is an OUTCOME and not an exception, because a deployment
 * without a database is a normal state and not an error: the endpoint answers
 * `unavailable`, the client shows neutral discovery, and nothing 500s. A
 * provider that threw for this would make "GeoIP is not set up here" look like
 * "GeoIP is broken" in every dashboard.
 */

/**
 * What a provider is allowed to tell Homiio about an address.
 *
 * Everything is optional except the country, because that is the only field a
 * city-level database is reliably able to answer, and a record that promised
 * more would push every consumer into defensive checks anyway. `accuracyRadiusKm`
 * is present ONLY when the provider publishes one with a documented meaning —
 * see the contract's note on why Homiio never computes it.
 */
export interface GeoIpRecord {
  /** ISO-3166-1 alpha-2, uppercase. */
  readonly countryCode: string;
  /** The bare ISO-3166-2 subdivision code (`CT`, not `ES-CT`), when known. */
  readonly regionCode?: string;
  readonly regionName?: string;
  readonly cityName?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly accuracyRadiusKm?: number;
}

export type GeoIpLookupOutcome =
  | { readonly status: 'found'; readonly record: GeoIpRecord }
  /** The database was asked and holds nothing for this address. */
  | { readonly status: 'not_found' }
  /** No database is configured in this deployment. */
  | { readonly status: 'not_configured' }
  /** The lookup failed or timed out. Retryable. */
  | { readonly status: 'error' };

export interface GeoIpProvider {
  /** Stable id, for metrics. Never a URL and never a credential. */
  readonly id: string;
  lookup(address: string): Promise<GeoIpLookupOutcome>;
}
