/**
 * Bucketing helpers for privacy-safe product observability.
 *
 * Every quantity an event may carry is reduced to a LABEL from a closed set
 * before it leaves the process. That is not a formatting preference: it is the
 * mechanism that makes an exact value impossible to emit. A raw result count,
 * a raw radius or a raw latency is a fingerprint that can be joined back to one
 * person's session; a label out of six is not.
 *
 * The three bucket sets the issue's own example payload names — result count,
 * radius and latency — use exactly the boundaries that example uses
 * (`'20-49'`, `'10-25'`, `'250-500'`), so a payload written from the issue
 * validates against this schema unchanged.
 *
 * Every function here is total: it accepts any finite number and returns a
 * label. A non-finite or negative input returns the lowest band rather than
 * throwing, because observability must never be able to break the action it is
 * observing.
 */

/** How many results a query returned. */
export const RESULT_COUNT_BUCKETS = ['0', '1-4', '5-19', '20-49', '50-199', '200+'] as const;
export type ResultCountBucket = (typeof RESULT_COUNT_BUCKETS)[number];

/** Search radius, in kilometres. */
export const RADIUS_BUCKETS_KM = [
  '0-1',
  '1-5',
  '5-10',
  '10-25',
  '25-50',
  '50-100',
  '100+',
] as const;
export type RadiusBucketKm = (typeof RADIUS_BUCKETS_KM)[number];

/** Wall-clock latency of a single request, in milliseconds. */
export const LATENCY_BUCKETS_MS = [
  '0-100',
  '100-250',
  '250-500',
  '500-1000',
  '1000-3000',
  '3000+',
] as const;
export type LatencyBucketMs = (typeof LATENCY_BUCKETS_MS)[number];

/**
 * How long a person spent on something, in seconds. Deliberately coarser than
 * the latency scale: a per-step duration measured to the millisecond is close
 * to a behavioural fingerprint, and the questions this answers ("which review
 * step do people abandon?") are answered at this resolution.
 */
export const DURATION_BUCKETS_S = ['0-5', '5-30', '30-120', '120-600', '600+'] as const;
export type DurationBucketS = (typeof DURATION_BUCKETS_S)[number];

/** Area of a map viewport that was searched, in square kilometres. */
export const AREA_BUCKETS_KM2 = [
  '0-1',
  '1-10',
  '10-100',
  '100-1000',
  '1000-10000',
  '10000+',
] as const;
export type AreaBucketKm2 = (typeof AREA_BUCKETS_KM2)[number];

/**
 * Map zoom expressed as what a person can see, not as a tile-server integer.
 * The integer is a proxy for scale and its meaning differs per renderer; the
 * label does not.
 */
export const ZOOM_BUCKETS = [
  'world',
  'country',
  'region',
  'city',
  'district',
  'street',
] as const;
export type ZoomBucket = (typeof ZOOM_BUCKETS)[number];

/**
 * Length of a free-text search term. The term itself is NEVER emitted — it can
 * contain a street, a building name or a landlord's name — but whether people
 * type at all, and roughly how much, is what tells us if free text and
 * geographic scope are being confused for each other.
 */
export const TEXT_LENGTH_BUCKETS = ['0', '1-10', '11-30', '31-80', '80+'] as const;
export type TextLengthBucket = (typeof TEXT_LENGTH_BUCKETS)[number];

/** Spread between the cheapest and dearest member of a duplicate group, in per cent. */
export const PERCENT_SPREAD_BUCKETS = ['0-5', '5-15', '15-30', '30-60', '60+'] as const;
export type PercentSpreadBucket = (typeof PERCENT_SPREAD_BUCKETS)[number];

/**
 * Map a value onto a band by its upper bounds.
 *
 * `bounds[i]` is the exclusive upper bound of `labels[i]`; the last label is
 * the overflow and has no bound. A non-finite or negative input lands in the
 * first band — see the module header for why this cannot throw.
 */
function bucketBy<T extends string>(
  value: number,
  bounds: readonly number[],
  labels: readonly T[],
): T {
  const first = labels[0];
  const overflow = labels[labels.length - 1];
  if (first === undefined || overflow === undefined) {
    throw new Error('bucketBy requires a non-empty label list');
  }
  if (!Number.isFinite(value) || value < 0) return first;
  for (let i = 0; i < bounds.length; i += 1) {
    const bound = bounds[i];
    const label = labels[i];
    if (bound !== undefined && label !== undefined && value < bound) return label;
  }
  return overflow;
}

/** Bucket a result count. `0` is its own band — zero results is a distinct outcome. */
export function resultCountBucket(count: number): ResultCountBucket {
  return bucketBy(count, [1, 5, 20, 50, 200], RESULT_COUNT_BUCKETS);
}

/** Bucket a search radius in kilometres. */
export function radiusBucketKm(km: number): RadiusBucketKm {
  return bucketBy(km, [1, 5, 10, 25, 50, 100], RADIUS_BUCKETS_KM);
}

/** Bucket a request latency in milliseconds. */
export function latencyBucketMs(ms: number): LatencyBucketMs {
  return bucketBy(ms, [100, 250, 500, 1000, 3000], LATENCY_BUCKETS_MS);
}

/** Bucket a person-facing duration in seconds. */
export function durationBucketS(seconds: number): DurationBucketS {
  return bucketBy(seconds, [5, 30, 120, 600], DURATION_BUCKETS_S);
}

/** Bucket a viewport area in square kilometres. */
export function areaBucketKm2(km2: number): AreaBucketKm2 {
  return bucketBy(km2, [1, 10, 100, 1000, 10000], AREA_BUCKETS_KM2);
}

/** Bucket a free-text term by its length. The term itself never leaves. */
export function textLengthBucket(length: number): TextLengthBucket {
  return bucketBy(length, [1, 11, 31, 81], TEXT_LENGTH_BUCKETS);
}

/** Bucket a percentage spread. */
export function percentSpreadBucket(percent: number): PercentSpreadBucket {
  return bucketBy(percent, [5, 15, 30, 60], PERCENT_SPREAD_BUCKETS);
}

/** One member's asking price, with the currency it is quoted in. */
export interface PricedListing {
  readonly amount: number;
  /** ISO-4217, e.g. `EUR`. */
  readonly currency: string;
}

/**
 * Spread across a duplicate group, or `undefined` when the group is not
 * comparable.
 *
 * The refusal is the point. Homiio aggregates portals across EUR, USD, PLN and
 * RON, so `(max - min) / min` over a mixed-currency group is arithmetic on
 * unlike quantities: 1200 PLN beside 1200 EUR reads as a 0% spread when the
 * real gap is roughly fourfold, and 350 000 RON beside 350 000 USD reads the
 * same way. A converted figure would need a rate, a rate date and a provenance
 * — which is #369's problem, not an observability event's — so the honest
 * answer here is to omit the field. `priceSpreadBucketPct` is optional in the
 * schema precisely so that "not comparable" has a representation.
 *
 * Also `undefined` for fewer than two members (nothing to spread) and for a
 * non-positive minimum (a division that would report `Infinity`).
 */
export function priceSpreadBucketPct(
  members: readonly PricedListing[],
): PercentSpreadBucket | undefined {
  if (members.length < 2) return undefined;

  const first = members[0];
  if (first === undefined) return undefined;
  if (members.some((member) => member.currency !== first.currency)) return undefined;

  const amounts = members.map((member) => member.amount).filter((amount) => Number.isFinite(amount));
  if (amounts.length !== members.length) return undefined;

  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (min <= 0) return undefined;

  return percentSpreadBucket(((max - min) / min) * 100);
}

/**
 * Map a map zoom level onto a scale label.
 *
 * The boundaries follow the web-mercator convention every renderer Homiio uses
 * shares (MapLibre, Leaflet, Google): z0 is the whole world, z≈16 is a street.
 */
export function zoomBucket(zoom: number): ZoomBucket {
  return bucketBy(zoom, [3, 6, 9, 12, 15], ZOOM_BUCKETS);
}
