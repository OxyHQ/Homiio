/**
 * The provider contract for the geocoding gateway.
 *
 * Everything here is PROVIDER-FACING and internal to the backend. None of it
 * reaches a client: the public DTO is `GeoPlace` and it is built in
 * `normalize.ts`, deliberately outside every adapter (ADR 0002 §9.2). An
 * adapter's whole job is to turn one portal's wire format into a
 * {@link ProviderPlace}; it knows nothing about Homiio's place taxonomy, its
 * cache, its rate limits or its HTTP contract. That is what makes swapping the
 * provider a change with no public consequence.
 */

/**
 * Why a provider call failed, as a closed set the gateway and the client can
 * both branch on.
 *
 * The distinction that carries weight is between the reasons a RETRY might fix
 * (`timeout`, `rate_limited`, `provider_unavailable`) and the ones it cannot
 * (`invalid_response`, `invalid_request`). Fallback to a second provider is
 * only ever considered for the first group — see `registry.ts`.
 *
 * `no_results` is deliberately NOT here. An empty candidate list is an ANSWER,
 * not a failure, and conflating the two is the bug this whole gateway exists to
 * prevent: a timeout that returns `[]` reads to a caller exactly like "there is
 * no such place", which is how a location search silently becomes a global
 * feed.
 */
export type GeocodingFailureReason =
  | 'timeout'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'invalid_request';

/** Failure reasons a different provider might plausibly answer correctly. */
const RECOVERABLE_REASONS: ReadonlySet<GeocodingFailureReason> = new Set([
  'timeout',
  'rate_limited',
  'provider_unavailable',
]);

/**
 * A typed provider failure.
 *
 * Never carries the query text or a coordinate: this object is what reaches the
 * logger and the error path, and ADR 0002 §8.2 forbids either in a log line.
 * The `message` is for operators and is composed from the reason and the
 * provider id alone.
 */
export class GeocodingProviderError extends Error {
  readonly reason: GeocodingFailureReason;
  readonly providerId: string;
  /** Seconds the provider asked us to wait, when it said so (HTTP 429). */
  readonly retryAfterSeconds?: number;

  constructor(
    reason: GeocodingFailureReason,
    providerId: string,
    retryAfterSeconds?: number,
  ) {
    super(`geocoding provider "${providerId}" failed: ${reason}`);
    this.name = 'GeocodingProviderError';
    this.reason = reason;
    this.providerId = providerId;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** Whether asking a DIFFERENT provider could plausibly answer this. */
  get isRecoverable(): boolean {
    return RECOVERABLE_REASONS.has(this.reason);
  }
}

/** WGS84 longitude/latitude, named so a pair can never be transposed. */
export interface ProviderPoint {
  readonly longitude: number;
  readonly latitude: number;
}

/**
 * A rectangle in degrees. `west > east` is legal and means the box crosses the
 * antimeridian — the same convention `GeoBounds` and PostGIS `::geography`
 * already use (ADR 0002 §9.3). `south > north` is an error and adapters must
 * not emit it.
 */
export interface ProviderBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * Address components in a PROVIDER-NEUTRAL vocabulary.
 *
 * Coalescing a portal's own key set onto these names (Nominatim's
 * `road|pedestrian|footway` onto `street`, `city|town|village|municipality`
 * onto `city`, and so on) is adapter work, because knowing which keys are
 * synonyms is exactly the portal-specific knowledge an adapter exists to hold.
 * Everything downstream reads these names and stays portable.
 */
export interface ProviderAddressParts {
  readonly street?: string;
  readonly houseNumber?: string;
  readonly neighborhood?: string;
  readonly city?: string;
  /** Province / state / autonomous community. */
  readonly region?: string;
  /** ISO-3166-2 subdivision code, when the provider supplies one. */
  readonly regionCode?: string;
  readonly country?: string;
  /** ISO-3166-1 alpha-2, uppercase. */
  readonly countryCode?: string;
  readonly postalCode?: string;
}

/**
 * One place as a provider describes it.
 *
 * `rawClass` / `rawType` are carried through UNINTERPRETED on purpose: mapping
 * them onto Homiio's `PlaceType` and `LocationPrecision` is normalisation, and
 * normalisation does not live in the adapter. An adapter that pre-decided the
 * place type would have to be edited every time Homiio's taxonomy moved, which
 * is the coupling the plugin boundary exists to remove.
 */
export interface ProviderPlace {
  /** The registered provider that produced this. */
  readonly providerId: string;
  /**
   * The provider's own stable reference, so a label is resolved at most once.
   * Must be stable across calls; it is half of the candidate's identity.
   */
  readonly ref: string;
  /**
   * The place's own name, provider-verbatim. NEVER re-cased, transliterated or
   * title-cased — ADR 0002 §9.4. This is `PlaceLabel.primary`.
   */
  readonly name: string;
  /** The provider's full display string, kept for diagnostics and fallbacks. */
  readonly displayName: string;
  readonly address: ProviderAddressParts;
  readonly center: ProviderPoint;
  readonly bounds?: ProviderBounds;
  /** The provider's own category, e.g. Nominatim's `class`. Uninterpreted. */
  readonly rawClass?: string;
  /** The provider's own subtype, e.g. Nominatim's `type`. Uninterpreted. */
  readonly rawType?: string;
  /** The provider's own address-level hint, e.g. Nominatim's `addresstype`. */
  readonly rawAddressType?: string;
}

/** What a provider must display alongside its results, and where it links. */
export interface ProviderAttribution {
  readonly text: string;
  readonly url: string;
}

export interface AutocompleteInput {
  /** Already trimmed and length-checked by the gateway. */
  readonly query: string;
  /** BCP-47 language tag the provider should answer in, when it can. */
  readonly language: string;
  /** ISO-3166-1 alpha-2, uppercase. Restricts results to one country. */
  readonly countryCode?: string;
  /**
   * A point to bias results towards. A BIAS, never a filter: a user who asks
   * for a place in another country must still get it (ADR 0002 §9.4, and the
   * issue's own required test).
   */
  readonly near?: ProviderPoint;
  /** Upper bound on candidates. The gateway caps this before calling. */
  readonly limit: number;
  readonly signal?: AbortSignal;
}

export interface ResolveInput {
  /** The provider's own ref, as carried in a `loc` token. */
  readonly ref: string;
  readonly language: string;
  readonly signal?: AbortSignal;
}

export interface ReverseInput {
  readonly point: ProviderPoint;
  readonly language: string;
  readonly signal?: AbortSignal;
}

export interface ProviderHealth {
  readonly providerId: string;
  readonly healthy: boolean;
  /** Operator-facing only. Never contains a query or a coordinate. */
  readonly detail?: string;
}

/**
 * A geocoding provider.
 *
 * Implementations THROW {@link GeocodingProviderError} on failure and return
 * data on success. Returning an empty array from `autocomplete`, or `null` from
 * `resolve`/`reverse`, means "the provider answered, and the answer is nothing"
 * — a claim only a healthy provider is allowed to make.
 */
export interface GeocodingProvider {
  readonly id: string;
  readonly attribution: ProviderAttribution;
  autocomplete(input: AutocompleteInput): Promise<ProviderPlace[]>;
  resolve(input: ResolveInput): Promise<ProviderPlace | null>;
  reverse(input: ReverseInput): Promise<ProviderPlace | null>;
  health(): Promise<ProviderHealth>;
}
