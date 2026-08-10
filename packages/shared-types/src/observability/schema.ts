/**
 * Versioned event schema for Homiio's privacy-safe product observability.
 *
 * WHY A SCHEMA AT ALL, AND WHY THIS SHAPE
 * ---------------------------------------
 * The geographic defects this observability exists to catch do not throw. A
 * screen can render perfectly while querying the wrong city, so the only way to
 * know what a person actually saw is to record the query — and recording a
 * query is exactly the thing that leaks where somebody lives. The resolution of
 * that tension is structural rather than procedural: **no field in this schema
 * has a kind that can hold free text or a fractional number.** There is no
 * `string` kind. A street name, a review body, an email, a document reference
 * and a pair of exact coordinates are therefore not "discouraged" values, they
 * are values with nowhere to go.
 *
 * Every declared field is one of:
 *
 *   - `enum`       — a closed set of labels, which is also how every bucket is
 *                    expressed (see `./buckets`);
 *   - `opaqueId`   — exactly 16 lowercase hex characters, derived by hashing;
 *   - `countryCode`— ISO-3166-1 alpha-2, the coarsest useful geography;
 *   - `boolean`;
 *   - `smallInt`   — a bounded, non-negative INTEGER (so a coordinate, a price
 *                    or a timestamp cannot pass as one);
 *   - `epochMs`    — the emitter's own clock stamp, bounded to a sane range.
 *
 * The TypeScript payload type of every event is DERIVED from the runtime spec
 * below (see `ObservabilityPayloads`). They cannot drift, because there is only
 * one declaration.
 *
 * VERSIONING
 * ----------
 * `OBSERVABILITY_SCHEMA_VERSION` is stamped on every event and checked on
 * receipt. Adding an optional field is a compatible change and does not bump
 * it. Removing a field, renaming one, changing a field's kind, or changing the
 * MEANING of an existing bucket boundary all bump it — a consumer that averages
 * `resultCountBucket` across a boundary change is computing a number that means
 * nothing, and the version is what lets it notice.
 */

import {
  AREA_BUCKETS_KM2,
  DURATION_BUCKETS_S,
  LATENCY_BUCKETS_MS,
  PERCENT_SPREAD_BUCKETS,
  RADIUS_BUCKETS_KM,
  RESULT_COUNT_BUCKETS,
  TEXT_LENGTH_BUCKETS,
  ZOOM_BUCKETS,
} from './buckets';

/** Bumped only for an incompatible change. See the module header. */
export const OBSERVABILITY_SCHEMA_VERSION = 1;

/** The platform the event came from. */
export const OBSERVABILITY_SURFACES = ['web', 'ios', 'android', 'server'] as const;
export type ObservabilitySurface = (typeof OBSERVABILITY_SURFACES)[number];

/**
 * How coarse a location a query was scoped to. `none` is a first-class value
 * and the most important one in this whole vocabulary: it is what makes an
 * unscoped, worldwide search visible instead of indistinguishable from a
 * correct city search.
 */
export const LOCATION_KINDS = [
  'city',
  'neighborhood',
  'region',
  'country',
  'bbox',
  'radius',
  'none',
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Where a location scope came from. */
export const LOCATION_SOURCES = [
  'device',
  'manual',
  'saved',
  'map',
  'url',
  'default',
] as const;

/** How precisely an address candidate resolves. Mirrors the publication ladder. */
export const ADDRESS_PRECISION_LEVELS = [
  'unit',
  'building',
  'street',
  'locality',
  'area',
] as const;
export type AddressPrecisionLevel = (typeof ADDRESS_PRECISION_LEVELS)[number];

/**
 * What a search fell back to when its intended scope could not be applied.
 *
 * `global` exists so that principle 4 of the epic — "a geocoding failure never
 * falls silently to a worldwide feed" — is MEASURABLE rather than merely
 * asserted in review. A deployment emitting any `global` here has the bug.
 */
export const SEARCH_FALLBACKS = [
  'none',
  'widened_radius',
  'dropped_filters',
  'last_known_area',
  'global',
] as const;
export type SearchFallback = (typeof SEARCH_FALLBACKS)[number];

/** The outcome of one geocoder call, classified rather than transcribed. */
export const GEOCODER_OUTCOMES = ['ok', 'empty', 'timeout', 'rate_limited', 'error'] as const;
export type GeocoderOutcome = (typeof GEOCODER_OUTCOMES)[number];

/** The steps of the review wizard, for step-level abandonment. */
export const REVIEW_STEPS = [
  'identify_address',
  'confirm_unit',
  'stay_period',
  'ratings',
  'free_text',
  'evidence',
  'summary',
  'submit',
] as const;

/** The event vocabulary. Adding a name here without a spec below fails to compile. */
export const OBSERVABILITY_EVENT_NAMES = [
  'location_permission_resolved',
  'location_selection_started',
  'location_selection_committed',
  'geocoder_request_completed',
  'search_submitted',
  'map_area_search_committed',
  'search_results_loaded',
  'search_zero_results',
  'housing_profile_opened',
  'address_candidate_selected',
  'review_step_completed',
  'review_abandoned',
  'listing_duplicate_group_opened',
] as const;
export type ObservabilityEventName = (typeof OBSERVABILITY_EVENT_NAMES)[number];

/** The kinds a field may declare. There is deliberately no free-text kind. */
export type ObservabilityFieldKind =
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'opaqueId' }
  | { readonly kind: 'countryCode' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'smallInt'; readonly max: number }
  | { readonly kind: 'epochMs' };

export interface ObservabilityFieldSpec {
  readonly type: ObservabilityFieldKind;
  readonly required: boolean;
}

export type ObservabilityEventSpec = Readonly<Record<string, ObservabilityFieldSpec>>;

const required = (type: ObservabilityFieldKind): ObservabilityFieldSpec => ({
  type,
  required: true,
});
const optional = (type: ObservabilityFieldKind): ObservabilityFieldSpec => ({
  type,
  required: false,
});

const opaqueId = { kind: 'opaqueId' } as const;
const countryCode = { kind: 'countryCode' } as const;
const boolean = { kind: 'boolean' } as const;
const enumOf = <T extends readonly string[]>(values: T) => ({ kind: 'enum', values }) as const;
const smallInt = <M extends number>(max: M) => ({ kind: 'smallInt', max }) as const;

/**
 * Fields every event carries, whatever its name.
 *
 * `schemaVersion` and `occurredAt` are stamped by the emitter, never by the
 * caller — a caller that supplies them has them overwritten. `sessionId` is an
 * opaque id the client rotates; it is NOT derived from an Oxy user id, and the
 * `opaqueId` kind refuses one anyway (a UUID does not match 16 hex characters).
 * It exists so that step-level abandonment can be measured without knowing who
 * abandoned.
 */
export const OBSERVABILITY_ENVELOPE_SPEC = {
  schemaVersion: required(smallInt(999)),
  occurredAt: required({ kind: 'epochMs' }),
  surface: required(enumOf(OBSERVABILITY_SURFACES)),
  sessionId: optional(opaqueId),
} as const satisfies ObservabilityEventSpec;

/**
 * Keys the envelope owns. An event spec declaring one of these would silently
 * shadow it in the flat payload shape, so `assertSchemaIsWellFormed` refuses it.
 */
export const OBSERVABILITY_RESERVED_KEYS = [
  'event',
  ...Object.keys(OBSERVABILITY_ENVELOPE_SPEC),
] as const;

/**
 * The per-event field specs.
 *
 * Read this as the privacy contract, not as a data dictionary: everything a
 * consumer will ever be able to ask of this pipeline is on this page.
 */
export const OBSERVABILITY_EVENT_SPECS = {
  /** Whether the device gave us a location, and whether we asked. */
  location_permission_resolved: {
    permissionState: required(
      enumOf(['granted', 'denied', 'undetermined', 'restricted', 'revoked'] as const),
    ),
    /** `true` when the grant is coarse-only (iOS "Precise: Off", Android COARSE). */
    coarse: required(boolean),
    promptShown: required(boolean),
    /** Set when a grant was obtained but no fix could be read. */
    coordinatesAvailable: optional(boolean),
  },

  /** Somebody opened a place picker. Pairs with `location_selection_committed`. */
  location_selection_started: {
    entryPoint: required(
      enumOf(['home', 'search', 'explore', 'map', 'saved_search', 'deep_link'] as const),
    ),
    priorSelectionKind: required(enumOf(LOCATION_KINDS)),
  },

  /** A scope was chosen. `queryId` is what makes it comparable with what got queried. */
  location_selection_committed: {
    queryId: required(opaqueId),
    locationKind: required(enumOf(LOCATION_KINDS)),
    countryCode: optional(countryCode),
    radiusBucketKm: optional(enumOf(RADIUS_BUCKETS_KM)),
    source: required(enumOf(LOCATION_SOURCES)),
    /**
     * `true` when more than one place matched the text and we had to choose.
     * Two cities called Barcelona is the canonical case (#295).
     */
    ambiguousMatch: optional(boolean),
  },

  /** One geocoder call. Provider health and latency without the search term. */
  geocoder_request_completed: {
    provider: required(enumOf(['internal', 'nominatim', 'photon', 'other'] as const)),
    direction: required(enumOf(['forward', 'reverse'] as const)),
    outcome: required(enumOf(GEOCODER_OUTCOMES)),
    httpStatusClass: required(enumOf(['none', '2xx', '3xx', '4xx', '5xx'] as const)),
    latencyBucketMs: required(enumOf(LATENCY_BUCKETS_MS)),
    resultCountBucket: optional(enumOf(RESULT_COUNT_BUCKETS)),
    cacheHit: required(boolean),
  },

  /** A search left the client. Free text is counted, never transcribed. */
  search_submitted: {
    queryId: required(opaqueId),
    locationKind: required(enumOf(LOCATION_KINDS)),
    countryCode: optional(countryCode),
    hasFreeText: required(boolean),
    freeTextLengthBucket: required(enumOf(TEXT_LENGTH_BUCKETS)),
    filterCount: required(smallInt(64)),
    radiusBucketKm: optional(enumOf(RADIUS_BUCKETS_KM)),
    mapMode: required(boolean),
  },

  /** "Search this area" was pressed. The event that must prove the old scope died. */
  map_area_search_committed: {
    queryId: required(opaqueId),
    /** The query the map replaced, so a survivor from the previous city is visible. */
    previousQueryId: optional(opaqueId),
    countryCode: optional(countryCode),
    areaBucketKm2: required(enumOf(AREA_BUCKETS_KM2)),
    zoomBucket: required(enumOf(ZOOM_BUCKETS)),
    crossesAntimeridian: required(boolean),
    /** `false` here with a changed viewport is the cross-city filter leak. */
    priorScopeCleared: required(boolean),
  },

  /** Results rendered. `stale` is the divergence the user cannot see. */
  search_results_loaded: {
    queryId: required(opaqueId),
    locationKind: required(enumOf(LOCATION_KINDS)),
    countryCode: optional(countryCode),
    resultCountBucket: required(enumOf(RESULT_COUNT_BUCKETS)),
    radiusBucketKm: optional(enumOf(RADIUS_BUCKETS_KM)),
    mapMode: required(boolean),
    latencyBucketMs: required(enumOf(LATENCY_BUCKETS_MS)),
    /** `true` when this result answers a query id that is no longer current. */
    stale: required(boolean),
  },

  /** Zero results, and — critically — what we did about it. */
  search_zero_results: {
    queryId: required(opaqueId),
    locationKind: required(enumOf(LOCATION_KINDS)),
    countryCode: optional(countryCode),
    radiusBucketKm: optional(enumOf(RADIUS_BUCKETS_KM)),
    filterCount: required(smallInt(64)),
    hasFreeText: required(boolean),
    fallbackApplied: required(enumOf(SEARCH_FALLBACKS)),
  },

  /** A persistent dwelling page was opened. */
  housing_profile_opened: {
    /** Opaque derivation of the canonical housing id — never the id itself. */
    housingRef: required(opaqueId),
    identityLevel: required(enumOf(['unit', 'building', 'street', 'unknown'] as const)),
    countryCode: optional(countryCode),
    activeListingCountBucket: required(enumOf(RESULT_COUNT_BUCKETS)),
    hasReviews: required(boolean),
  },

  /** An address candidate was picked, and whether it became canonical. */
  address_candidate_selected: {
    candidateSource: required(
      enumOf(['geocoder', 'internal', 'listing', 'map_pin'] as const),
    ),
    precisionLevel: required(enumOf(ADDRESS_PRECISION_LEVELS)),
    materialized: required(boolean),
    countryCode: optional(countryCode),
  },

  /** One review-wizard step finished. `wizardId` is opaque and per-draft. */
  review_step_completed: {
    wizardId: required(opaqueId),
    stepId: required(enumOf(REVIEW_STEPS)),
    stepIndex: required(smallInt(32)),
    durationBucketS: required(enumOf(DURATION_BUCKETS_S)),
  },

  /** A review draft was abandoned. The funnel-loss counterpart of the above. */
  review_abandoned: {
    wizardId: required(opaqueId),
    lastStepId: required(enumOf(REVIEW_STEPS)),
    lastStepIndex: required(smallInt(32)),
    durationBucketS: required(enumOf(DURATION_BUCKETS_S)),
    reason: required(
      enumOf(['navigated_away', 'closed', 'error', 'timeout', 'unknown'] as const),
    ),
  },

  /** A duplicate group was expanded — the anti-double-counting surface. */
  listing_duplicate_group_opened: {
    groupRef: required(opaqueId),
    memberCountBucket: required(enumOf(RESULT_COUNT_BUCKETS)),
    providerCount: required(smallInt(32)),
    priceSpreadBucketPct: optional(enumOf(PERCENT_SPREAD_BUCKETS)),
    countryCode: optional(countryCode),
  },
} as const satisfies Readonly<Record<ObservabilityEventName, ObservabilityEventSpec>>;

/* ────────────────────────────────────────────────────────────────────────────
 * Payload types, DERIVED from the specs above so the two cannot disagree.
 * ──────────────────────────────────────────────────────────────────────── */

type ValueOfKind<K extends ObservabilityFieldKind> = K extends { kind: 'enum'; values: infer V }
  ? V extends readonly (infer Item)[]
    ? Item
    : never
  : K extends { kind: 'opaqueId' }
    ? string
    : K extends { kind: 'countryCode' }
      ? string
      : K extends { kind: 'boolean' }
        ? boolean
        : K extends { kind: 'smallInt' }
          ? number
          : K extends { kind: 'epochMs' }
            ? number
            : never;

type RequiredKeysOf<S extends ObservabilityEventSpec> = {
  [K in keyof S]: S[K]['required'] extends true ? K : never;
}[keyof S];

type OptionalKeysOf<S extends ObservabilityEventSpec> = {
  [K in keyof S]: S[K]['required'] extends true ? never : K;
}[keyof S];

type PayloadOf<S extends ObservabilityEventSpec> = {
  [K in RequiredKeysOf<S>]: ValueOfKind<S[K]['type']>;
} & {
  [K in OptionalKeysOf<S>]?: ValueOfKind<S[K]['type']>;
};

/** The caller-supplied fields of each event, derived from its spec. */
export type ObservabilityPayloads = {
  [E in ObservabilityEventName]: PayloadOf<(typeof OBSERVABILITY_EVENT_SPECS)[E]>;
};

/** The envelope fields the emitter stamps, plus the optional session id. */
export type ObservabilityEnvelopeFields = PayloadOf<typeof OBSERVABILITY_ENVELOPE_SPEC>;

/**
 * A complete event as it reaches a transport: FLAT, exactly the shape the issue
 * documents, with the envelope fields alongside the event's own.
 */
export type ObservabilityEvent<E extends ObservabilityEventName = ObservabilityEventName> =
  ObservabilityEnvelopeFields & { event: E } & ObservabilityPayloads[E];

/**
 * Structural checks on the schema itself, run by the test suite.
 *
 * A schema is data, and data drifts: an event added to the name list with no
 * spec, a spec that shadows an envelope key, an enum declared empty (which
 * would accept nothing and refuse every event carrying that field). None of
 * those is a type error, and each one degrades the pipeline silently, so they
 * are asserted rather than assumed. Returns the problems it found; an empty
 * array is the passing case.
 */
export function assertSchemaIsWellFormed(): string[] {
  const problems: string[] = [];
  const specs: Readonly<Record<string, ObservabilityEventSpec>> = OBSERVABILITY_EVENT_SPECS;

  for (const name of OBSERVABILITY_EVENT_NAMES) {
    const spec = specs[name];
    if (spec === undefined) {
      problems.push(`event "${name}" has no field spec`);
      continue;
    }
    if (Object.keys(spec).length === 0) {
      problems.push(`event "${name}" declares no fields`);
    }
    for (const [field, fieldSpec] of Object.entries(spec)) {
      if ((OBSERVABILITY_RESERVED_KEYS as readonly string[]).includes(field)) {
        problems.push(`event "${name}" declares reserved envelope key "${field}"`);
      }
      if (fieldSpec.type.kind === 'enum' && fieldSpec.type.values.length === 0) {
        problems.push(`event "${name}" field "${field}" declares an empty enum`);
      }
      if (fieldSpec.type.kind === 'smallInt' && fieldSpec.type.max <= 0) {
        problems.push(`event "${name}" field "${field}" declares a non-positive max`);
      }
    }
  }

  for (const name of Object.keys(specs)) {
    if (!(OBSERVABILITY_EVENT_NAMES as readonly string[]).includes(name)) {
      problems.push(`spec "${name}" is not in the event vocabulary`);
    }
  }

  return problems;
}
