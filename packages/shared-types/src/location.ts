/**
 * The one canonical location contract — ADR 0002 (#346), implementing §3, §3.1,
 * §5.2, §9.3 and the fixture obligations of §12 and §16.
 *
 * WHY THIS FILE EXISTS. Homiio answers "where?" in nine incompatible ways
 * (ADR §1.2), three of which are coordinate encodings inside this package
 * alone. None of the resulting bugs — a list of Barcelona homes under a map of
 * Madrid, a saved search that reopens in another country, a "Near you" lens
 * that filters nothing — is a mistake in the file where it surfaces. They are
 * all consequences of there being no shared answer. This module is that answer,
 * and it is deliberately the ONLY place in the codebase where a location
 * becomes a string.
 *
 * SCOPE OF THIS FILE. It is the FOUNDATION half of #352: the types, the key
 * function, the `loc` token codec and the small validators. Nothing is migrated
 * onto it here — `SearchLocation`, `buildSearchParams`, the frontend store and
 * the backend controllers are all untouched, and the translation table in
 * ADR §10 is the work list for that separate change.
 *
 * THREE THINGS A READER WILL WONDER ABOUT, ANSWERED HERE.
 *
 * 1. `GeoPoint` and `GeoBounds` are ALSO declared in
 *    `./observability/queryIdentity`, which predates this file. `GeoBounds` is
 *    structurally identical, so nothing can tell the two apart. `GeoPoint` is
 *    NOT: that one is `{ lat, lng }` and this one is `{ longitude, latitude }`.
 *    The package barrel resolves both names to THIS module (see `index.ts`),
 *    because ADR §3 is normative about the canonical encoding and the whole
 *    epic converges here. Converging the observability copy onto it is the
 *    migration change's job, not this one's — so the older declaration is left
 *    exactly where it is, reachable at its own module path.
 *
 * 2. The GeoJSON polygon shapes are MIRRORED LOCALLY rather than imported.
 *    ADR §3 writes them as `GeoJSON.Polygon | GeoJSON.MultiPolygon`, which is
 *    the ambient global namespace `@types/geojson` declares — and this package
 *    is dependency-free by design (see the header of `./observability`), so
 *    taking that dependency to name two structural types would be a poor trade.
 *    `./common` was the other candidate and has nothing to reuse: it declares
 *    `GeoJSONPoint` and no polygon shape at all. Mirroring keeps the wire
 *    format identical to GeoJSON while leaving §2.1's reservation intact.
 *
 * 3. Parsing a `loc` token yields a `LocationRef`, NOT a `LocationSelection`.
 *    A token carries an identity and a geometry; it deliberately carries no
 *    label, no admin hierarchy and no centre for a named place, because those
 *    come from resolving it (§6.2). A parser that filled them in with
 *    placeholders would produce exactly the partially-filled selection §5.2
 *    forbids, so it returns the honest, smaller thing instead.
 *
 *    THE ASYMMETRY IS THE SAFETY PROPERTY, not an inconvenience to design
 *    around. Returning a selection would mean INVENTING a label, and §4.1
 *    forbids a label being fed back as free text — so a parser that guessed one
 *    would manufacture, at the URL boundary, precisely the value the contract
 *    exists to keep out of `q`.
 */

// ---------------------------------------------------------------------------
// §3 — the shared type
// ---------------------------------------------------------------------------

/** WGS84 point. ONE encoding, named fields — a positional pair is transposable. */
export interface GeoPoint {
  readonly longitude: number;
  readonly latitude: number;
}

/**
 * A rectangle in degrees.
 *
 * `south > north` is an ERROR. `west > east` is LEGAL and means the box crosses
 * the antimeridian (west 170 → east -170 is the 20-degree strip over the
 * Pacific, not the 340-degree rest of the world). See ADR §9.3 — this is the
 * only bounding-box representation that can express that at all, and PostGIS
 * `::geography` already reads it this way, which was verified against a real
 * server rather than assumed.
 *
 * The consequence worth writing down, because it is what a later "tidy-up"
 * would destroy: adding a `west <= east` validation, or dropping the
 * `::geography` cast in `propertyGeo.ts`, silently inverts every antimeridian
 * query into its exact complement — the far side of the planet, returned
 * confidently.
 */
export interface GeoBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** A GeoJSON position, `[longitude, latitude]`. Mirrored locally — see the module header. */
export type GeoJSONPosition = readonly [number, number];

/** A GeoJSON Polygon: an outer ring followed by any number of holes. */
export interface GeoJSONPolygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly GeoJSONPosition[])[];
}

/** A GeoJSON MultiPolygon: several polygons, each with its own rings. */
export interface GeoJSONMultiPolygon {
  readonly type: 'MultiPolygon';
  readonly coordinates: readonly (readonly (readonly GeoJSONPosition[])[])[];
}

/**
 * What a coordinate MEANS. Declared, never inferred.
 *
 *  - `exact`       a building-level point somebody deliberately provided.
 *  - `approximate` an exact point deliberately degraded (rounded or offset).
 *  - `centroid`    the representative point of an AREA. Not anyone's location.
 *  - `area`        the EXTENT is the meaning. Any point is derived framing
 *                  rather than the place's own location, and there may be no
 *                  point at all.
 *
 * The distinction that matters most is that a `centroid` IS NOT ANYBODY'S
 * LOCATION. A city centre is a framing device, and code that treats it as a
 * home's position is wrong in a way no other type in this package prevents.
 *
 * `area` PREVIOUSLY READ "no meaningful point at all", and that was wrong in a
 * way that mattered — see §19(C) of the ADR. `map_bounds` has always carried
 * `precision: 'area'` AND a required centre, because a viewport's centre is
 * real, so the old wording contradicted a variant sitting forty lines below it.
 * Two implementers read that sentence and reached opposite conclusions. What
 * `area` actually distinguishes is whether the point is the PLACE or merely a
 * way to FRAME it; whether a point exists at all is now said structurally, by
 * {@link PlaceGeometry}.
 */
export type LocationPrecision = 'exact' | 'approximate' | 'centroid' | 'area';

/**
 * Whether a place has a representative point, said in the type rather than in a
 * comment nobody is obliged to read.
 *
 * THE BUG THIS CLOSES, MEASURED. `center` used to be REQUIRED beside a
 * `precision` that could say `area`, so a country — which has no centroid in
 * this schema — could not be expressed honestly. The geocoding gateway
 * therefore emitted `{ longitude: 0, latitude: 0 }` for every country and
 * region, and the search screen drew its fallback box around that, so picking
 * "Spain" returned zero listings over a map of the Gulf of Guinea. Nothing
 * threw; zero results is the plausible-looking failure, which is why it
 * survived review.
 *
 * `(0, 0)` IS A REAL COORDINATE — it is a point in the Atlantic, and longitude
 * zero runs through Greenwich, Accra and Tema. So a type that forces it as the
 * "no centre" value cannot distinguish ABSENT from THERE, which is the same
 * family as a check that cannot distinguish success from failure. Absence has
 * to be its own state.
 *
 * `center?: never` rather than a plain optional, and the difference is not
 * stylistic: a plain `center?: GeoPoint` beside an open `precision` still
 * ACCEPTS `{ precision: 'area', center }` — verified — so it would leave the
 * contradiction discouraged rather than unrepresentable. `never` refuses it
 * both as an object literal and through a variable, which is the shape the
 * gateway actually writes. It also makes the MIRROR unrepresentable for free: a
 * `centroid` with no centre no longer compiles, and a one-directional guard
 * here would only be half a guard.
 *
 * `bounds` stays OPTIONAL on the `area` branch on purpose. Requiring it would
 * simply move the fabrication one field across — a country with no bbox in this
 * schema would have to invent a rectangle instead of a point, which is the same
 * lie with a larger footprint. A place with neither is honestly unframeable,
 * and the caller must say so rather than guess.
 */
export type PlaceGeometry =
  | {
      /** A real point: the place's own location, or a deliberate degradation of it. */
      readonly precision: 'exact' | 'approximate' | 'centroid';
      readonly center: GeoPoint;
      readonly bounds?: GeoBounds;
    }
  | {
      /** An extent. There is no representative point, and none may be supplied. */
      readonly precision: 'area';
      readonly center?: never;
      readonly bounds?: GeoBounds;
    };

/** A display label, pre-split by whoever knows how. Never `label.split(',')[0]`. */
export interface PlaceLabel {
  /** e.g. "Barcelona", "شارع الحمرا", "千代田区". */
  readonly primary: string;
  /** e.g. "Catalonia, Spain". Optional: some places have no meaningful parent. */
  readonly secondary?: string;
  /**
   * `generated` marks a label Homiio invented ("Map area", "Near you").
   * A generated label is never sent as free text and never re-geocoded.
   */
  readonly kind: 'place' | 'generated';
}

/** Explicit administrative hierarchy. `countryCode` is never optional. */
export interface AdminHierarchy {
  /** ISO-3166-1 alpha-2, uppercase. */
  readonly countryCode: string;
  /** ISO-3166-2 subdivision code where one exists. */
  readonly regionCode?: string;
  readonly regionName?: string;
  readonly cityName?: string;
  readonly neighborhoodName?: string;
}

/**
 * Where a place came from, and whether Homiio owns it.
 *
 * The distinction is the point: `homiio` is a row in this database with a
 * primary key that will still mean the same place after a provider swap;
 * `external` is a candidate a geocoder handed us, whose ref is only as stable
 * as that provider. An `external` place therefore MUST carry its own
 * centre/bounds inline so it survives the provider disappearing.
 */
export type PlaceSource =
  | {
      readonly kind: 'homiio';
      readonly entity: 'country' | 'region' | 'city' | 'neighborhood' | 'address';
      readonly id: string;
    }
  | {
      readonly kind: 'external';
      /** Registered provider id, e.g. `osm`. Never a URL, never a class name. */
      readonly provider: string;
      /** The provider's own stable ref, so a label is never geocoded twice. */
      readonly ref: string;
    };

export type PlaceType = 'country' | 'region' | 'city' | 'district' | 'neighborhood' | 'postcode';

export type LocationSelection =
  /** The device's own position. Coordinates are resolved at request time and NEVER serialised. */
  | {
      readonly kind: 'current_location';
      readonly center: GeoPoint;
      readonly radiusMeters: number;
      /**
       * Narrowed to the two values a device fix can actually have. A position
       * is a point: `centroid` and `area` are properties of an AREA and were
       * never meaningful here, and the same lie this contract just removed from
       * `place` was expressible here for the same reason.
       */
      readonly precision: 'exact' | 'approximate';
    }
  /**
   * A named area: a country, region, city, district, neighborhood or postcode.
   *
   * Its geometry comes from {@link PlaceGeometry}: a `centroid` with a centre,
   * or `area` with none. A country has no centroid in this schema and says so
   * rather than pointing at the Atlantic.
   */
  | ({
      readonly kind: 'place';
      readonly source: PlaceSource;
      readonly placeType: PlaceType;
      readonly label: PlaceLabel;
      readonly admin: AdminHierarchy;
    } & PlaceGeometry)
  /** A specific address a geocoder proposed but Homiio has not materialised. */
  | ({
      readonly kind: 'address_candidate';
      readonly source: PlaceSource;
      readonly label: PlaceLabel;
      readonly admin: AdminHierarchy;
    } & PlaceGeometry)
  /**
   * A map viewport the user confirmed. Has no name and never acquires one.
   *
   * `precision: 'area'` with a REQUIRED centre, which is not the contradiction
   * it looks like and is why {@link PlaceGeometry} is not applied here: a
   * viewport's centre is real, and it is supplied by whoever built the viewport
   * rather than derived downstream. That matters concretely — the naive
   * midpoint of an antimeridian box is WRONG: for `west 170, east -170` it
   * computes `(170 + -170) / 2 = 0` and lands in the Gulf of Guinea, when the
   * true centre is 180. Dropping this field would push every consumer into
   * exactly that arithmetic.
   */
  | {
      readonly kind: 'map_bounds';
      readonly bounds: GeoBounds;
      readonly center: GeoPoint;
      readonly label: PlaceLabel & { readonly kind: 'generated' };
      readonly precision: 'area';
      /** Countries the box overlaps, when known. A box may span several. */
      readonly countryCodes?: readonly string[];
    }
  /** A drawn area. Wire format reserved; nothing is required to persist one yet. */
  | {
      readonly kind: 'polygon';
      readonly polygon: GeoJSONPolygon | GeoJSONMultiPolygon;
      readonly bounds: GeoBounds;
      readonly label: PlaceLabel;
      readonly precision: 'area';
    }
  /** Several areas at once. Cannot nest. */
  | {
      readonly kind: 'multi_area';
      readonly areas: readonly Exclude<LocationSelection, { kind: 'multi_area' }>[];
      readonly label: PlaceLabel;
    };

/** Every selection kind except `multi_area` — what a `multi_area` may contain. */
export type SingleLocationSelection = Exclude<LocationSelection, { kind: 'multi_area' }>;

/**
 * The full query. `location` and `text` are separate dimensions and neither is
 * derived from the other.
 */
export interface LocationQuery {
  readonly location: LocationSelection | null;
  /** What the user typed as free text. NEVER a place label. */
  readonly text: string | null;
}

/** Why a resolution failed. The UI must distinguish these; they are not one state. */
export type LocationFailureReason =
  | 'network'
  | 'rate_limited'
  | 'ambiguous'
  | 'no_results'
  | 'permission_denied'
  | 'position_unavailable'
  | 'unsupported';

export type LocationResolution =
  | { readonly status: 'idle' }
  | { readonly status: 'resolving' }
  | { readonly status: 'resolved'; readonly selection: LocationSelection }
  | { readonly status: 'failed'; readonly reason: LocationFailureReason };

// ---------------------------------------------------------------------------
// §9.2 / §14.1 — the gateway DTO
// ---------------------------------------------------------------------------

/**
 * What a gateway candidate IS.
 *
 * `address` is the one value that is not a `PlaceType`: it becomes an
 * `address_candidate` selection, every other value becomes a `place`. That
 * single discriminator is why `GeoPlace` needs no optional variant fields —
 * ADR §14.1's `types?` parameter uses exactly this vocabulary
 * (`city,neighborhood,address`).
 */
export type GeoPlaceType = PlaceType | 'address';

/**
 * The geocoding gateway's response element (ADR §9.2, §14.1) — Homiio's shape,
 * defined ONCE, not a geocoder's `address` object flattened.
 *
 * It replaces `AddressData`, which is declared twice today with different
 * fields: the backend copy carries `coordinates` and `bbox`, the frontend copy
 * drops both, so the backend computes a bounding box the frontend's type cannot
 * represent. Both copies die when #351 serves this instead.
 *
 * `GET /api/geo/search` returns `{ candidates: GeoPlace[] }` — ALWAYS a list.
 * Auto-picking one is the homonym bug (ADR §12.2), and the list is what makes
 * the `disambiguating` state of §7 possible.
 */
export type GeoPlace = {
  readonly source: PlaceSource;
  readonly placeType: GeoPlaceType;
  readonly label: PlaceLabel;
  readonly admin: AdminHierarchy;
} & PlaceGeometry;

/**
 * Turn a gateway candidate into the selection the user just chose.
 *
 * Shared rather than written per screen because the `address` →
 * `address_candidate` mapping is the one place a caller could quietly decide
 * that a street address is a "place", which would then key by the wrong
 * identity for the rest of its life.
 */
export function geoPlaceToSelection(place: GeoPlace): LocationSelection {
  // Narrowed on `precision` and carried across whole, rather than rebuilt field
  // by field. Spreading `center` conditionally would let an `area` place
  // acquire one on the way through — the exact state `PlaceGeometry` exists to
  // make unrepresentable, reintroduced by the function that is supposed to
  // preserve it.
  const geometry: PlaceGeometry =
    place.precision === 'area'
      ? { precision: 'area', ...(place.bounds === undefined ? {} : { bounds: place.bounds }) }
      : {
          precision: place.precision,
          center: place.center,
          ...(place.bounds === undefined ? {} : { bounds: place.bounds }),
        };

  if (place.placeType === 'address') {
    return {
      kind: 'address_candidate',
      source: place.source,
      label: place.label,
      admin: place.admin,
      ...geometry,
    };
  }
  return {
    kind: 'place',
    source: place.source,
    placeType: place.placeType,
    label: place.label,
    admin: place.admin,
    ...geometry,
  };
}

// ---------------------------------------------------------------------------
// Validators (ADR §9.3)
// ---------------------------------------------------------------------------

/** A latitude in degrees. Latitude does NOT wrap — beyond a pole is meaningless. */
export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

/** A longitude in degrees, already inside the canonical range. See {@link normalizeLongitude}. */
export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Wrap a longitude into `[-180, 180)`.
 *
 * This is ADR §9.3's fix, and it lives here so it happens ONCE. The concrete
 * bug it closes: `WhereStep` builds a synthetic ±0.05° box around a picked
 * point, so at longitude 179.98 the east edge is 180.03, the range check
 * rejects it, and the whole search fails with `INVALID_GEO_PARAMS` — every
 * place within 0.05° of the antimeridian is unsearchable. Normalising gives
 * `west 179.93, east -179.97`, a `west > east` box, which is legal and which
 * PostGIS `::geography` already reads correctly.
 *
 * The range is HALF-OPEN on purpose: 180 and -180 are the same meridian, so
 * leaving both spellings legal would produce two different tokens and two
 * different cache keys for one box.
 */
export function normalizeLongitude(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  // A value already in range is returned UNCHANGED, and this fast path is not
  // an optimisation — the modulo arithmetic below is lossy, so running it on an
  // in-range longitude turns 2.1686 into 2.1685999999999694. That is a token
  // that no longer round-trips and a cache key that drifts every time a URL is
  // re-serialised, for coordinates that never needed wrapping at all.
  if (value >= -180 && value < 180) return value === 0 ? 0 : value;
  const wrapped = (((value + 180) % 360) + 360) % 360 - 180;
  // -0 can fall out of the modulo; normalise it so two spellings of zero cannot
  // produce two tokens.
  return wrapped === 0 ? 0 : wrapped;
}

/**
 * Whether a rectangle is well formed.
 *
 * REJECTS `south > north`. ACCEPTS `west > east`, which is not laxity — it is
 * the antimeridian case, and a box that crosses it has no other spelling. A
 * fixture set without an antimeridian box cannot tell this function from one
 * that validates both orderings, which is why the suite carries one.
 *
 * A degenerate box (`south === north`, or `west === east`) is accepted: it is a
 * zero-area query, not a malformed one.
 */
export function isValidBounds(bounds: GeoBounds): boolean {
  if (!isValidLatitude(bounds.south) || !isValidLatitude(bounds.north)) return false;
  if (!isValidLongitude(bounds.west) || !isValidLongitude(bounds.east)) return false;
  return bounds.south <= bounds.north;
}

// ---------------------------------------------------------------------------
// §3.1 — `locationKey`, the stable identifier
// ---------------------------------------------------------------------------

/**
 * Grid for any coordinate that reaches a key, a log or an analytics event:
 * 2 dp ≈ 1.1 km of latitude (ADR §8.3, the device-position row).
 *
 * `locationKey` itself never emits a bare coordinate — that is the whole point
 * of its `current_location` branch — so this constant is exported for the
 * device-position code that lands with the rest of #352, so that the grid is
 * read from the contract rather than retyped as a literal `2`.
 */
export const KEY_COORD_DECIMALS = 2;

/** Grid for a bbox in a key: 3 dp ≈ 110 m — coarse enough to absorb map jitter. */
export const KEY_BOUNDS_DECIMALS = 3;

/**
 * Decimals a coordinate keeps inside a `loc` token: 6 dp ≈ 11 cm, finer than
 * any map interaction can express.
 *
 * This is a formatting bound, not a privacy one — the URL carries the area
 * actually queried, and rounding it further would change the query. It exists
 * because JavaScript switches to exponent notation below 1e-6 (`String(1e-7)`
 * is `"1e-7"`), which the strict token parser rejects, so an unrounded
 * serialiser would emit tokens its own parser refuses — an asymmetric codec,
 * and one that only fails within 11 cm of Greenwich or the equator.
 */
export const TOKEN_COORD_DECIMALS = 6;

/** Round onto a decimal grid, normalising `-0` to `0`. */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  // Without this, a box straddling Greenwich or the equator keys differently
  // depending on which side of zero the float landed on.
  return rounded === 0 ? 0 : rounded;
}

/** A bbox component in a key, or `na` rather than a `NaN` nobody can act on. */
function keyCoordinate(value: number): string {
  return Number.isFinite(value) ? String(roundTo(value, KEY_BOUNDS_DECIMALS)) : 'na';
}

/**
 * The one function that turns a selection into a string, for URL serialisation,
 * React Query keys, saved-search identity and analytics.
 *
 * That "one" is the enforcement mechanism for ADR §8.2, not a stylistic
 * preference. Six places leak an exact coordinate today — two React Query keys,
 * a server log, AsyncStorage, a geocoder-response store and an unbounded device
 * fix — and they are all fixed by routing through a function whose
 * `current_location` branch HAS NO COORDINATE TO EMIT. A single test therefore
 * guards all six, where a sweep would have to be re-run forever.
 *
 * Two properties are what the key is FOR: two different cities called Barcelona
 * produce two different keys (they have different ids, and the key is built
 * from the id, never the label), and a jittering map viewport produces one key
 * (the 3 dp grid).
 */
export function locationKey(selection: LocationSelection | null): string {
  if (!selection) return 'none';
  switch (selection.kind) {
    case 'current_location':
      // NO coordinates. A device fix never reaches a key, a URL or a log.
      return `here:${selection.radiusMeters}`;
    case 'place':
    case 'address_candidate':
      return selection.source.kind === 'homiio'
        ? `${selection.source.kind}:${selection.source.entity}:${selection.source.id}`
        : `ext:${selection.source.provider}:${selection.source.ref}`;
    case 'map_bounds':
    case 'polygon': {
      const b = selection.bounds;
      return `bbox:${keyCoordinate(b.west)},${keyCoordinate(b.south)},${keyCoordinate(b.east)},${keyCoordinate(b.north)}`;
    }
    case 'multi_area':
      // Sorted, so the key does not depend on the order the areas were picked.
      return `multi:${selection.areas.map(locationKey).sort().join('+')}`;
    default: {
      // A new selection kind must decide its own key rather than inherit one.
      const exhaustive: never = selection;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// §5.2 — the `loc` URL token codec
// ---------------------------------------------------------------------------

/**
 * Why a token could not be produced or read.
 *
 * These are distinct on purpose. An unparseable `loc` is a FAILURE, not an
 * absence (ADR §5.2): it must reach `resolution.status = 'failed'` and show an
 * error, and it must never silently become a global feed. A codec returning
 * `null` for both "no token" and "bad token" is how that distinction gets lost,
 * so this codec has no `null` in it at all — a caller says "absent" by not
 * calling it.
 */
export type LocationTokenFailure =
  /** The token was empty or whitespace. */
  | 'empty'
  /** The leading segment names no production in the §5.2 grammar. */
  | 'unknown_kind'
  /** The right prefix with the wrong shape — missing segments, empty id. */
  | 'malformed'
  /** A coordinate or radius that is not a plain finite decimal. */
  | 'not_a_number'
  /** A latitude outside ±90, `south > north`, or a non-positive radius. */
  | 'out_of_range'
  /** `multi.` inside `multi.` — the selection type forbids nesting. */
  | 'nested_multi'
  /** A selection kind §5.2 has no production for. Today: `polygon` (§2.1 reserves it). */
  | 'unsupported_kind'
  /** An id or provider carrying a separator the grammar cannot escape. */
  | 'unencodable_id'
  /**
   * A token carrying a coordinate pair — today only the withdrawn `at.` form.
   *
   * Distinct from `unknown_kind` on purpose. `at.` was a real production of
   * §5.2 until it was withdrawn (§19(B)), so somebody meeting this failure is
   * far more likely to be holding an old copy of the grammar than to have made
   * a typo, and the reason should tell them which. Decision 8 is the rule:
   * exact coordinates never appear in a URL, and `here.<radiusMeters>` exists
   * so the device case carries none.
   */
  | 'coordinates_in_url';

export type LocationTokenResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: LocationTokenFailure };

/** Which authority a `loc` token's `source` segment names. */
export type LocationRefSource =
  | { readonly kind: 'homiio' }
  | { readonly kind: 'external'; readonly provider: string };

/**
 * The parsed form of a `loc` token — everything the grammar can carry, and
 * nothing it cannot.
 *
 * This is not a `LocationSelection`, and the difference is deliberate: a token
 * for a named place carries an id and no label, admin hierarchy or centre,
 * because those are supplied by resolving it against the gateway (§6.2). A
 * parser that invented them would hand the app a selection that looks resolved
 * and is not.
 */
export type LocationRef =
  /** `city.homiio.<id>`, `address.osm.<ref>`, … */
  | {
      readonly kind: 'place';
      readonly placeType: GeoPlaceType;
      readonly source: LocationRefSource;
      readonly id: string;
    }
  /** `bbox.<west>,<south>,<east>,<north>` */
  | { readonly kind: 'bounds'; readonly bounds: GeoBounds }
  /**
   * NOTE: there is deliberately no `point` member here.
   *
   * §5.2 carried an `at.<lng>,<lat>,<radiusMeters>` production until it was
   * withdrawn (§19(B)) — no coordinate pair belongs in a URL (decision 8), and
   * no `LocationSelection` kind ever mapped to it, so it was a form the parser
   * accepted and the serialiser could not produce. A grammar that blesses a
   * shape is how the shape gets used, so it is rejected rather than parsed
   * leniently. `here.<radiusMeters>` is the device case and carries nothing.
   */
  /** `here.<radiusMeters>` — NEVER any coordinates. */
  | { readonly kind: 'device'; readonly radiusMeters: number }
  /** `multi.<loc>+<loc>[+…]` — two or more, never nested. */
  | { readonly kind: 'multi'; readonly refs: readonly Exclude<LocationRef, { kind: 'multi' }>[] };

/** The reserved `source` segment meaning "a row in this database". */
const HOMIIO_SOURCE = 'homiio';

const PLACE_TYPES: readonly GeoPlaceType[] = [
  'country',
  'region',
  'city',
  'district',
  'neighborhood',
  'postcode',
  'address',
];

/** Separates the parts of a `multi.` token, so no segment may contain it. */
const MULTI_SEPARATOR = '+';

function fail<T>(reason: LocationTokenFailure): LocationTokenResult<T> {
  return { ok: false, reason };
}

function ok<T>(value: T): LocationTokenResult<T> {
  return { ok: true, value };
}

/**
 * A plain finite decimal, and nothing else.
 *
 * `Number('')` is `0` and `Number(' 5 ')` is `5`, so the built-in conversion
 * turns an empty or padded segment into a real coordinate — which is how
 * `bbox.,,,` would parse as the point 0,0 and be queried in the Gulf of Guinea.
 * Exponent and `+` forms are refused too, so that exactly one spelling of each
 * number is a valid token.
 */
function parseDecimal(raw: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function formatCoordinate(value: number): string {
  return String(roundTo(value, TOKEN_COORD_DECIMALS));
}

/** A segment that would break the grammar if it appeared inside a token. */
function isEncodableSegment(value: string, forbidDots: boolean): boolean {
  if (value.length === 0) return false;
  if (value.includes(MULTI_SEPARATOR)) return false;
  if (forbidDots && value.includes('.')) return false;
  return true;
}

/**
 * The reference a selection serialises to, or why it cannot.
 *
 * `polygon` is the one kind with no answer: §2.1 reserves its wire format
 * deliberately, so refusing is correct and degrading it to its bounding box
 * would not be. A bounding box is a SUPERSET of the drawn area, so that
 * fallback silently WIDENS the search the user asked for — the same failure
 * family as a resolution failure becoming a global feed (§4.3), differing only
 * in how much extra ground it quietly covers. It is also the "half the location
 * survived" bug the atomic selection exists to make unrepresentable.
 */
export function locationRefOf(selection: LocationSelection): LocationTokenResult<LocationRef> {
  switch (selection.kind) {
    case 'current_location':
      return ok({ kind: 'device', radiusMeters: selection.radiusMeters });
    case 'place':
      return ok({
        kind: 'place',
        placeType: selection.placeType,
        source: refSourceOf(selection.source),
        id: sourceIdOf(selection.source),
      });
    case 'address_candidate':
      return ok({
        kind: 'place',
        placeType: 'address',
        source: refSourceOf(selection.source),
        id: sourceIdOf(selection.source),
      });
    case 'map_bounds':
      return ok({ kind: 'bounds', bounds: selection.bounds });
    case 'polygon':
      return fail('unsupported_kind');
    case 'multi_area': {
      const refs: Exclude<LocationRef, { kind: 'multi' }>[] = [];
      for (const area of selection.areas) {
        const result = locationRefOf(area);
        if (!result.ok) return result;
        // `areas` cannot hold a `multi_area`, so this cannot be a `multi` ref.
        refs.push(result.value as Exclude<LocationRef, { kind: 'multi' }>);
      }
      return ok({ kind: 'multi', refs });
    }
    default: {
      const exhaustive: never = selection;
      return exhaustive;
    }
  }
}

function refSourceOf(source: PlaceSource): LocationRefSource {
  return source.kind === 'homiio' ? { kind: 'homiio' } : { kind: 'external', provider: source.provider };
}

function sourceIdOf(source: PlaceSource): string {
  return source.kind === 'homiio' ? source.id : source.ref;
}

/**
 * Render a reference as a `loc` token.
 *
 * Longitudes are normalised here (§9.3) because this is "the shared serialiser"
 * the ADR names, so the antimeridian fix happens once instead of at every call
 * site that builds a box.
 */
export function serializeLocationRef(ref: LocationRef): LocationTokenResult<string> {
  switch (ref.kind) {
    case 'place': {
      if (!PLACE_TYPES.includes(ref.placeType)) return fail('unknown_kind');
      if (!isEncodableSegment(ref.id, false)) return fail('unencodable_id');
      if (ref.source.kind === 'homiio') {
        return ok(`${ref.placeType}.${HOMIIO_SOURCE}.${ref.id}`);
      }
      // A provider literally called `homiio` would produce a token that reads
      // as a canonical Homiio id — the one collision the grammar cannot resolve.
      if (ref.source.provider === HOMIIO_SOURCE) return fail('unencodable_id');
      if (!isEncodableSegment(ref.source.provider, true)) return fail('unencodable_id');
      return ok(`${ref.placeType}.${ref.source.provider}.${ref.id}`);
    }
    case 'bounds': {
      const bounds = normalizedBounds(ref.bounds);
      if (!isValidBounds(bounds)) return fail('out_of_range');
      return ok(
        `bbox.${formatCoordinate(bounds.west)},${formatCoordinate(bounds.south)},` +
          `${formatCoordinate(bounds.east)},${formatCoordinate(bounds.north)}`,
      );
    }
    case 'device': {
      const radius = radiusToken(ref.radiusMeters);
      if (radius === null) return fail('out_of_range');
      // NO coordinates: a shared "near me" link means "near the opener".
      return ok(`here.${radius}`);
    }
    case 'multi': {
      if (ref.refs.length < 2) return fail('malformed');
      const parts: string[] = [];
      for (const part of ref.refs) {
        const result = serializeLocationRef(part);
        if (!result.ok) return result;
        parts.push(result.value);
      }
      return ok(`multi.${parts.join(MULTI_SEPARATOR)}`);
    }
    default: {
      const exhaustive: never = ref;
      return exhaustive;
    }
  }
}

/**
 * The `loc` token for a selection.
 *
 * `loc` is ONE parameter on purpose (§5.1). The entire bug class this contract
 * exists for is "half of the previous location survived", and a single atomic
 * token makes a half-update unrepresentable in the URL as well as in the store.
 */
export function serializeLocationToken(selection: LocationSelection): LocationTokenResult<string> {
  const ref = locationRefOf(selection);
  return ref.ok ? serializeLocationRef(ref.value) : ref;
}

/**
 * Read a `loc` token.
 *
 * Deliberately strict: one spelling per value, case-sensitive prefixes, no
 * padding and no exponent forms. Being liberal here would mean two URLs for one
 * query, which splits the cache and breaks the round-trip §16.1 requires.
 */
export function parseLocationToken(token: string): LocationTokenResult<LocationRef> {
  if (token.length === 0) return fail('empty');

  const dot = token.indexOf('.');
  if (dot <= 0) return fail('unknown_kind');
  const head = token.slice(0, dot);
  const rest = token.slice(dot + 1);

  if (head === 'multi') return parseMultiToken(rest);
  if (head === 'here') return parseDeviceToken(rest);
  if (head === 'bbox') return parseBoundsToken(rest);
  // The withdrawn `at.` production (§19(B)). Rejected with a reason that names
  // the rule, not treated as an unknown prefix — see `LocationTokenFailure`.
  if (head === 'at') return fail('coordinates_in_url');
  if ((PLACE_TYPES as readonly string[]).includes(head)) {
    return parsePlaceToken(head as GeoPlaceType, rest);
  }
  return fail('unknown_kind');
}

function parsePlaceToken(placeType: GeoPlaceType, rest: string): LocationTokenResult<LocationRef> {
  const dot = rest.indexOf('.');
  if (dot <= 0) return fail('malformed');
  const sourceSegment = rest.slice(0, dot);
  // Everything after the SECOND dot is the id, so an id containing dots
  // round-trips. A ULID does not, but a provider ref is not ours to constrain.
  const id = rest.slice(dot + 1);
  if (!isEncodableSegment(id, false)) return fail('malformed');
  const source: LocationRefSource =
    sourceSegment === HOMIIO_SOURCE ? { kind: 'homiio' } : { kind: 'external', provider: sourceSegment };
  if (source.kind === 'external' && !isEncodableSegment(source.provider, true)) {
    return fail('malformed');
  }
  return ok({ kind: 'place', placeType, source, id });
}

function parseBoundsToken(rest: string): LocationTokenResult<LocationRef> {
  const parts = rest.split(',');
  if (parts.length !== 4) return fail('malformed');
  const values: number[] = [];
  for (const part of parts) {
    const value = parseDecimal(part);
    if (value === null) return fail('not_a_number');
    values.push(value);
  }
  const bounds = normalizedBounds({
    west: values[0],
    south: values[1],
    east: values[2],
    north: values[3],
  });
  if (!isValidBounds(bounds)) return fail('out_of_range');
  return ok({ kind: 'bounds', bounds });
}

function parseDeviceToken(rest: string): LocationTokenResult<LocationRef> {
  const radiusMeters = parseDecimal(rest);
  if (radiusMeters === null) return fail('not_a_number');
  if (radiusMeters <= 0) return fail('out_of_range');
  return ok({ kind: 'device', radiusMeters });
}

function parseMultiToken(rest: string): LocationTokenResult<LocationRef> {
  const parts = rest.split(MULTI_SEPARATOR);
  // The grammar is `"multi." loc ( "+" loc )+` — two or more, never one.
  if (parts.length < 2) return fail('malformed');
  const refs: Exclude<LocationRef, { kind: 'multi' }>[] = [];
  for (const part of parts) {
    // Checked BEFORE recursing, so a nested `multi.` is reported as what it is.
    // Recursing first reports whatever the inner token's own shape happens to
    // be — a nested `multi.here.25000` comes back `malformed`, because after
    // the split it has only one part — and a caller switching on the reason to
    // choose a message would show the wrong one.
    if (part.startsWith('multi.')) return fail('nested_multi');
    const result = parseLocationToken(part);
    if (!result.ok) return result;
    if (result.value.kind === 'multi') return fail('nested_multi');
    refs.push(result.value);
  }
  return ok({ kind: 'multi', refs });
}

/** A radius rendered for a token, or `null` when it is not a usable distance. */
function radiusToken(radiusMeters: number): string | null {
  if (!Number.isFinite(radiusMeters)) return null;
  const rounded = roundTo(radiusMeters, 3);
  return rounded > 0 ? String(rounded) : null;
}

function normalizedBounds(bounds: GeoBounds): GeoBounds {
  return {
    west: normalizeLongitude(bounds.west),
    south: bounds.south,
    east: normalizeLongitude(bounds.east),
    north: bounds.north,
  };
}
