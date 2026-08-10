/**
 * Query identity — the one thing a list and a map must agree about.
 *
 * The defect class this exists for renders perfectly: the header says
 * "Barcelona", the map frames Barcelona, and the list is answering a request
 * that still carries Madrid's bounds. Nothing throws, no type is violated, and
 * the only way to see it is to ask both surfaces which query they are showing
 * and compare the answers. That comparison needs a single deterministic
 * identifier derived from the EFFECTIVE query — not from whichever object each
 * surface happens to hold.
 *
 * PRECISION IS DELIBERATELY COARSE, AND THAT IS THE PRIVACY CONTROL
 * -----------------------------------------------------------------
 * Coordinates are rounded to {@link QUERY_ID_COORD_DECIMALS} decimal places
 * (~110 m at the equator) BEFORE hashing. A query id therefore cannot resolve
 * finer than a city block even to somebody who inverts it, which is what makes
 * it safe to emit. Two viewports 50 m apart produce the same id — accepted,
 * because at that distance they are the same query for every question this
 * pipeline answers.
 *
 * The in-app divergence checks in `./invariants` do NOT rely on the id for
 * geometric comparisons; they work on the real numbers with an explicit
 * tolerance, so the coarse grid here never masks a real area mismatch.
 *
 * RESIDUAL, STATED PLAINLY: the id is a hash of the whole effective query,
 * free text included. Recovering it means guessing the entire descriptor —
 * scope, filters, sort and text — not just the text. It is not a stable
 * per-person identifier and it is not reversible to a dwelling. It is not a
 * cryptographic commitment either, and nothing should treat it as one.
 */

import type { LocationKind } from './schema';

/** ~110 m at the equator. See the module header for why this is not finer. */
export const QUERY_ID_COORD_DECIMALS = 3;

/** Prefix on every canonical string, so a future canonicalisation change is visible. */
export const QUERY_CANONICAL_VERSION = 'q1';

/** A west/south/east/north box in degrees, matching the geo layer's `bbox` order. */
export interface GeoBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** A point in degrees. */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** Filter values a query may carry. Arrays are order-insensitive. */
export type QueryFilterValue = string | number | boolean | readonly string[];

/**
 * The effective query, as opposed to whatever intermediate state a screen
 * holds. Every surface that renders results must be able to produce this, and
 * two surfaces showing "the same search" must produce equal descriptors.
 */
export interface QueryDescriptor {
  readonly locationKind: LocationKind;
  readonly countryCode?: string;
  /**
   * A STABLE KEY for the place when the scope is a named place rather than a
   * shape — the same key `LocationScopeContract.placeKey` carries, never a
   * display string. Two cities called Barcelona differ here and nowhere else.
   */
  readonly placeKey?: string;
  readonly center?: GeoPoint;
  readonly radiusKm?: number;
  readonly bounds?: GeoBounds;
  readonly freeText?: string;
  readonly filters?: Readonly<Record<string, QueryFilterValue | undefined>>;
  readonly sort?: string;
}

const FNV_PRIME = 0x01000193;
const FNV_OFFSET_A = 0x811c9dc5;
/** A second, unrelated basis: two independent 32-bit digests make a 64-bit id. */
const FNV_OFFSET_B = 0x9dc5811c;

/**
 * FNV-1a over UTF-16 code units, byte by byte.
 *
 * Written out rather than imported because this package is dependency-free by
 * design and the digest must be byte-identical on Hermes, on Node and in a
 * browser — a hash that disagrees across runtimes turns the divergence check
 * into a false alarm on every cross-tier comparison.
 */
function fnv1a32(input: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    hash = Math.imul(hash ^ (code & 0xff), FNV_PRIME);
    hash = Math.imul(hash ^ ((code >>> 8) & 0xff), FNV_PRIME);
  }
  return hash >>> 0;
}

function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * Domain separator between a namespace and its value.
 *
 * Written as an ESCAPE, never as a literal byte. A NUL inside a source file
 * makes git classify that file as binary, so it merges with no reviewable diff
 * at all — every gate passes and no reviewer can see a line of it. That is the
 * exact hazard `packages/backend/__tests__/unit/sourceFilesAreText.test.ts`
 * exists to catch, and it caught this file in CI after a local full-suite run
 * missed it: the local run happened while the file was still UNTRACKED, and
 * that gate enumerates with `git ls-files`, which cannot see an untracked file.
 *
 * NUL is the right SEPARATOR — it cannot occur in a namespace or an id, so no
 * pair of inputs can collide by concatenation. It is only the literal byte in
 * SOURCE that is the problem, and the escape produces the identical digest.
 */
const NAMESPACE_SEPARATOR = '\u0000';

/** 16 lowercase hex characters — the one shape the `opaqueId` field kind accepts. */
export function digest16(input: string): string {
  return hex8(fnv1a32(input, FNV_OFFSET_A)) + hex8(fnv1a32(input, FNV_OFFSET_B));
}

/**
 * Round a coordinate onto the published grid.
 *
 * `-0` is normalised to `0`: without it a viewport straddling Greenwich or the
 * equator hashes differently depending on which side the float landed on, and
 * the divergence check fires on two surfaces that agree.
 */
function coordinate(value: number): string {
  if (!Number.isFinite(value)) return 'na';
  const factor = 10 ** QUERY_ID_COORD_DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  return (rounded === 0 ? 0 : rounded).toFixed(QUERY_ID_COORD_DECIMALS);
}

/** Radius is rounded to 100 m, the same order as the coordinate grid. */
function radius(value: number): string {
  if (!Number.isFinite(value)) return 'na';
  return (Math.round(value * 10) / 10).toFixed(1);
}

/**
 * Normalise free text so that trivial keyboard differences are not treated as
 * different queries. Case and surrounding/repeated whitespace only — no
 * accent folding, because `String.prototype.normalize` is not guaranteed on
 * every Hermes build and a digest that differs by runtime is worse than one
 * that treats "Lleida" and "lleida" alike but "Lérida" and "Lerida" apart.
 */
function freeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function filterValue(value: QueryFilterValue): string {
  if (Array.isArray(value)) {
    return [...(value as readonly string[])].map((entry) => String(entry)).sort().join(',');
  }
  return String(value);
}

/**
 * The canonical string a query id is the digest of.
 *
 * Exported because a failing divergence assertion is far easier to act on when
 * a test can print the two canonical forms side by side — a pair of hex
 * digests tells you they differ and nothing about how.
 */
export function canonicalQueryDescriptor(descriptor: QueryDescriptor): string {
  const parts: string[] = [
    QUERY_CANONICAL_VERSION,
    `kind=${descriptor.locationKind}`,
    `country=${descriptor.countryCode === undefined ? '' : descriptor.countryCode.toUpperCase()}`,
    `place=${descriptor.placeKey ?? ''}`,
    `center=${
      descriptor.center === undefined
        ? ''
        : `${coordinate(descriptor.center.lat)},${coordinate(descriptor.center.lng)}`
    }`,
    `radius=${descriptor.radiusKm === undefined ? '' : radius(descriptor.radiusKm)}`,
    `bounds=${
      descriptor.bounds === undefined
        ? ''
        : [
            coordinate(descriptor.bounds.west),
            coordinate(descriptor.bounds.south),
            coordinate(descriptor.bounds.east),
            coordinate(descriptor.bounds.north),
          ].join(',')
    }`,
    `text=${descriptor.freeText === undefined ? '' : freeText(descriptor.freeText)}`,
    `sort=${descriptor.sort ?? ''}`,
  ];

  const filters = descriptor.filters;
  if (filters !== undefined) {
    const encoded = Object.keys(filters)
      .sort()
      .flatMap((key) => {
        const value = filters[key];
        return value === undefined ? [] : [`${key}:${filterValue(value)}`];
      });
    parts.push(`filters=${encoded.join(';')}`);
  } else {
    parts.push('filters=');
  }

  return parts.join('|');
}

/**
 * The identifier a list and a map must both be able to produce for the search
 * they are showing. Deterministic, dependency-free and stable across runtimes.
 */
export function deriveQueryId(descriptor: QueryDescriptor): string {
  return digest16(canonicalQueryDescriptor(descriptor));
}

/**
 * Derive the opaque reference an event carries for a domain entity.
 *
 * The namespace keeps references from different domains from colliding and,
 * more usefully, stops the same underlying id producing the same reference in
 * two unrelated events — which would let a reader join a review draft to a
 * housing profile across the log.
 */
export function deriveOpaqueRef(namespace: string, value: string): string {
  return digest16(`${namespace}${NAMESPACE_SEPARATOR}${value}`);
}

/** Whether a value is in the one shape the `opaqueId` field kind accepts. */
export function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

/**
 * Mint a fresh opaque id — a rotating session or wizard reference.
 *
 * `random` is injected so a test can pin the output; production passes
 * `Math.random`. This is NOT a security token and must never be used as one:
 * it identifies a sequence of events as belonging to one uninterrupted visit,
 * and nothing else.
 */
export function newOpaqueId(random: () => number = Math.random): string {
  let out = '';
  while (out.length < 16) {
    const chunk = Math.floor(random() * 0x100000000) >>> 0;
    out += hex8(chunk);
  }
  return out.slice(0, 16);
}
