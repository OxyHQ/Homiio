/**
 * The `loc` URL token codec (ADR 0002 §5.2), and the antimeridian rule of §9.3.
 *
 * `loc` is ONE parameter on purpose: the entire bug class this contract exists
 * for is "half of the previous location survived", and an atomic token makes a
 * half-update unrepresentable in the URL as well as in the store. These tests
 * are therefore mostly about EXACTNESS — a codec that loses or invents a field
 * reintroduces the bug through the back door.
 *
 * ADR §16(1) requires the round trip URL → store → API request → URL to be
 * character-for-character identical. That is asserted here on the two halves
 * this module owns: token → parse → serialise → token, and selection → token →
 * parse → the same reference the selection produces directly.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: that parsing yields a full
 * `LocationSelection`. It cannot, and must not pretend to — a token for a named
 * place carries an id and no label, admin hierarchy or centre, because those
 * come from resolving it (§6.2). The tests below pin that boundary rather than
 * papering over it.
 */

import {
  isValidBounds,
  isValidLatitude,
  isValidLongitude,
  locationRefOf,
  normalizeLongitude,
  parseLocationToken,
  serializeLocationRef,
  serializeLocationToken,
  type GeoBounds,
  type LocationRef,
  type LocationSelection,
  type LocationTokenResult,
  type PlaceLabel,
} from '@homiio/shared-types';

type PlaceSelection = Extract<LocationSelection, { kind: 'place' }>;

const PLACE_LABEL: PlaceLabel = { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' };

/** Unwrap a result, failing loudly with the reason rather than on `undefined`. */
function expectOk<T>(result: LocationTokenResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got failure: ${result.reason}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// §16(1) — the round trip
// ---------------------------------------------------------------------------

describe('loc token: round trip is character-for-character', () => {
  /**
   * One token per production of the §5.2 grammar, plus the two the ADR calls
   * out by name. Every one of these is a token a URL could really carry.
   */
  const TOKENS = [
    // A canonical Homiio place, for each place type the grammar admits.
    'country.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA',
    'region.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTB',
    'city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA',
    'district.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTC',
    'neighborhood.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTD',
    'postcode.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTE',
    'address.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTF',
    // An external candidate, whose ref is the provider's own.
    'city.osm.R349036',
    'address.osm.N1234567890',
    // A map viewport.
    'bbox.-3.75,40.38,-3.65,40.45',
    // The antimeridian box §9.3 measured against a real PostGIS. `west > east`.
    'bbox.170,-20,-170,-16',
    // "Near me", carrying NO coordinates.
    'here.25000',
    // Several areas at once.
    'multi.city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA+bbox.2.05,41.32,2.23,41.47',
    'multi.here.25000+city.osm.R349036+bbox.170,-20,-170,-16',
  ] as const;

  it.each(TOKENS)('%s survives parse then serialise unchanged', (token) => {
    const ref = expectOk(parseLocationToken(token));
    expect(expectOk(serializeLocationRef(ref))).toBe(token);
  });

  /**
   * A vacuity floor. If `TOKENS` were ever emptied or filtered down by a bad
   * edit, `it.each` would run nothing and the suite would still be green — the
   * same shape as a census that reports zero because its traversal broke.
   */
  it('covers every production of the grammar', () => {
    expect(TOKENS.length).toBeGreaterThanOrEqual(14);
    const heads = new Set(TOKENS.map((token) => token.slice(0, token.indexOf('.'))));
    expect(heads).toEqual(
      new Set([
        'country',
        'region',
        'city',
        'district',
        'neighborhood',
        'postcode',
        'address',
        'bbox',
        'here',
        'multi',
      ]),
    );
  });

  it('round-trips a place id containing dots', () => {
    // Everything after the SECOND dot is the id, so a provider ref with dots is
    // not ours to reject. A parser splitting on every dot would truncate it.
    const token = 'address.osm.way.123.456';
    const ref = expectOk(parseLocationToken(token));
    expect(ref).toEqual({
      kind: 'place',
      placeType: 'address',
      source: { kind: 'external', provider: 'osm' },
      id: 'way.123.456',
    });
    expect(expectOk(serializeLocationRef(ref))).toBe(token);
  });
});

// ---------------------------------------------------------------------------
// selection → token
// ---------------------------------------------------------------------------

describe('loc token: a selection serialises to its reference', () => {
  const BARCELONA_ES: PlaceSelection = {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
    placeType: 'city',
    label: PLACE_LABEL,
    admin: { countryCode: 'ES', regionName: 'Catalonia' },
    center: { longitude: 2.1686, latitude: 41.3874 },
    precision: 'centroid',
  };

  it('emits the token ADR §13.3 shows', () => {
    expect(expectOk(serializeLocationToken(BARCELONA_ES))).toBe(
      'city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA',
    );
  });

  /**
   * The exactness property in the direction that matters for §6.1: what comes
   * back out of the URL is the same reference the store put in. Anything the
   * token drops (label, admin, centre) is recovered by resolving, never guessed.
   */
  it('parses back to the reference the selection produces directly', () => {
    const token = expectOk(serializeLocationToken(BARCELONA_ES));
    expect(expectOk(parseLocationToken(token))).toEqual(expectOk(locationRefOf(BARCELONA_ES)));
  });

  it('does not carry the label, so two Barcelonas cannot collapse', () => {
    const token = expectOk(serializeLocationToken(BARCELONA_ES));
    expect(token).not.toContain('Barcelona');
    expect(token).not.toContain('Catalonia');
  });

  it('serialises an address candidate under the `address` production', () => {
    const candidate: Extract<LocationSelection, { kind: 'address_candidate' }> = {
      kind: 'address_candidate',
      source: { kind: 'external', provider: 'osm', ref: 'N1234567890' },
      label: { primary: 'Carrer de Mallorca 401', kind: 'place' },
      admin: { countryCode: 'ES' },
      center: { longitude: 2.1743, latitude: 41.4036 },
      precision: 'exact',
    };
    expect(expectOk(serializeLocationToken(candidate))).toBe('address.osm.N1234567890');
  });

  it('emits `here.<radius>` with no coordinates for a device fix', () => {
    const here: LocationSelection = {
      kind: 'current_location',
      center: { longitude: 13.4678, latitude: 41.3874 },
      radiusMeters: 25000,
      precision: 'exact',
    };
    const token = expectOk(serializeLocationToken(here));
    expect(token).toBe('here.25000');
    // A shared "near me" link means "near the OPENER". Any leak here would be
    // a device position pasted into somebody else's browser history.
    expect(token).not.toContain('13.4');
    expect(token).not.toContain('41.3');
  });

  /**
   * §2.1 reserves the polygon wire format deliberately, so the honest answer is
   * a typed refusal. Degrading it to its bounding box would silently replace a
   * drawn area with a rectangle — the same "half the location survived" class
   * the atomic selection exists to prevent, arrived at from the other side.
   */
  it('refuses a polygon rather than degrading it to its bounds', () => {
    const polygon: Extract<LocationSelection, { kind: 'polygon' }> = {
      kind: 'polygon',
      polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [2.05, 41.32],
            [2.23, 41.32],
            [2.23, 41.47],
            [2.05, 41.32],
          ],
        ],
      },
      bounds: { west: 2.05, south: 41.32, east: 2.23, north: 41.47 },
      label: { primary: 'Drawn area', kind: 'generated' },
      precision: 'area',
    };
    const result = serializeLocationToken(polygon);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('unsupported_kind');
  });

  it('propagates that refusal out of a multi_area containing a polygon', () => {
    const polygon: Extract<LocationSelection, { kind: 'polygon' }> = {
      kind: 'polygon',
      polygon: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] },
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      label: { primary: 'Drawn area', kind: 'generated' },
      precision: 'area',
    };
    const result = serializeLocationToken({
      kind: 'multi_area',
      areas: [BARCELONA_ES, polygon],
      label: { primary: '2 areas', kind: 'generated' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('unsupported_kind');
  });

  /**
   * `multi.` preserves the author's order while `locationKey` sorts. The
   * asymmetry is deliberate and worth pinning: §16(1) wants an exact URL round
   * trip (so the token may not reorder), and §3.1 wants an order-independent
   * identity (so the key must). Both properties hold literally, and neither
   * would if one function tried to serve both.
   */
  it('preserves the order of a multi_area in the token', () => {
    const first = expectOk(
      serializeLocationToken({
        kind: 'multi_area',
        areas: [
          BARCELONA_ES,
          { kind: 'current_location', center: { longitude: 0, latitude: 0 }, radiusMeters: 25000, precision: 'exact' },
        ],
        label: { primary: '2 areas', kind: 'generated' },
      }),
    );
    const second = expectOk(
      serializeLocationToken({
        kind: 'multi_area',
        areas: [
          { kind: 'current_location', center: { longitude: 0, latitude: 0 }, radiusMeters: 25000, precision: 'exact' },
          BARCELONA_ES,
        ],
        label: { primary: '2 areas', kind: 'generated' },
      }),
    );
    expect(first).toBe('multi.city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA+here.25000');
    expect(second).toBe('multi.here.25000+city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA');
  });
});

// ---------------------------------------------------------------------------
// §5.2 — an unparseable token is a FAILURE, not an absence
// ---------------------------------------------------------------------------

describe('loc token: a bad token is distinguishable from no token', () => {
  const BAD: readonly (readonly [string, string])[] = [
    ['', 'empty'],
    ['city', 'unknown_kind'],
    ['.homiio.abc', 'unknown_kind'],
    ['nonsense.homiio.abc', 'unknown_kind'],
    ['BBOX.1,2,3,4', 'unknown_kind'],
    ['Here.25000', 'unknown_kind'],
    // The withdrawn `at.` production (ADR §19(B)). A WELL-FORMED one, so the
    // rejection is about the rule and not about the shape.
    ['at.2.1734,41.3851,25000', 'coordinates_in_url'],
    ['at.1,2', 'coordinates_in_url'],
    ['city.homiio.', 'malformed'],
    ['city.homiio', 'malformed'],
    ['bbox.1,2,3', 'malformed'],
    ['bbox.1,2,3,4,5', 'malformed'],
    ['multi.city.homiio.abc', 'malformed'],
    ['bbox.,,,', 'not_a_number'],
    ['here.', 'not_a_number'],
    ['here.abc', 'not_a_number'],
    ['here. 25000', 'not_a_number'],
    ['here.2.5e4', 'not_a_number'],
    ['here.+25000', 'not_a_number'],
    ['bbox.1,2,3,four', 'not_a_number'],
    ['here.0', 'out_of_range'],
    ['here.-5', 'out_of_range'],
    ['bbox.2.05,41.47,2.23,41.32', 'out_of_range'],
    ['bbox.2.05,-91,2.23,41.47', 'out_of_range'],
    ['multi.city.homiio.abc+multi.here.25000+here.500', 'nested_multi'],
  ];

  it.each(BAD)('%s fails with %s', (token, reason) => {
    const result = parseLocationToken(token);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe(reason);
    // The point of the whole exercise: no half-built selection escapes, and
    // there is no `null` for a caller to mistake for "no location was asked
    // for". A failed `loc` must reach `resolution.status = 'failed'`, never a
    // global feed.
    expect('value' in result).toBe(false);
  });

  it('has a failing case for every reason the parser can return', () => {
    const covered = new Set(BAD.map(([, reason]) => reason));
    expect(covered).toEqual(
      new Set([
        'empty',
        'unknown_kind',
        'malformed',
        'not_a_number',
        'out_of_range',
        'nested_multi',
        'coordinates_in_url',
      ]),
    );
  });

  /**
   * `Number('')` is `0`, so a permissive parser reads `bbox.,,,` as the box
   * 0,0,0,0 — a valid-looking zero-area query in the Gulf of Guinea, returned
   * as an empty result set that reads like "nothing here". This is the single
   * most plausible-looking wrong answer in the whole codec.
   */
  it('does not read an empty segment as zero', () => {
    const result = parseLocationToken('bbox.,,,');
    expect(result.ok).toBe(false);
    const zeroBox = parseLocationToken('bbox.0,0,0,0');
    // Control: the box really is expressible, so the refusal above is about the
    // empty segments and not about zero being rejected.
    expect(zeroBox.ok).toBe(true);
  });

  /**
   * ADR §19(B). `at.<lng>,<lat>,<radiusMeters>` was a real production of §5.2
   * until it was withdrawn, and the fixture is a WELL-FORMED one on purpose: a
   * malformed `at.` would be refused by shape alone, which cannot tell a
   * withdrawn production from a typo.
   *
   * Decision 8 is the rule — exact coordinates never appear in a URL, and
   * `here.<radiusMeters>` exists so the device case carries none. The danger
   * was never a token somebody types by hand; it is that a grammar blessing the
   * shape is how "search around this pin" gets wired to it later.
   */
  it('rejects the withdrawn `at.` production, because decision 8 forbids a coordinate pair in a URL', () => {
    const result = parseLocationToken('at.2.1734,41.3851,25000');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // A reason that names the RULE, not `unknown_kind` — somebody meeting this
    // is likelier to hold an old copy of §5.2 than to have made a typo.
    expect(result.reason).toBe('coordinates_in_url');
  });

  it('rejects an `at.` part nested inside a multi token', () => {
    // The withdrawal has to hold everywhere the grammar recurses, or `multi.`
    // becomes the way back in.
    const result = parseLocationToken('multi.city.homiio.abc+at.2.1734,41.3851,25000');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('coordinates_in_url');
  });

  /**
   * Negative control for both assertions above: `here.` is the surviving
   * radius-bearing production and must still parse. Without this, deleting
   * every radius form would pass the two rejections.
   */
  it('still accepts the coordinate-free device production', () => {
    expect(parseLocationToken('here.25000')).toEqual({
      ok: true,
      value: { kind: 'device', radiusMeters: 25000 },
    });
  });

  it('refuses an id carrying the multi separator rather than corrupting a multi token', () => {
    const result = serializeLocationRef({
      kind: 'place',
      placeType: 'city',
      source: { kind: 'homiio' },
      id: 'a+b',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('unencodable_id');
  });

  /**
   * A provider literally called `homiio` would emit `city.homiio.<ref>`, which
   * reads as a canonical Homiio id — the one collision the grammar has no way
   * to resolve, and the one that would silently hand a provider's ref to a
   * database lookup.
   */
  it('refuses an external provider named `homiio`', () => {
    const result = serializeLocationRef({
      kind: 'place',
      placeType: 'city',
      source: { kind: 'external', provider: 'homiio' },
      id: 'R349036',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('unencodable_id');
  });

  it('refuses a multi of fewer than two parts', () => {
    const single: LocationRef = {
      kind: 'multi',
      refs: [{ kind: 'device', radiusMeters: 25000 }],
    };
    const result = serializeLocationRef(single);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('malformed');
  });
});

// ---------------------------------------------------------------------------
// §9.3 — the antimeridian
// ---------------------------------------------------------------------------

describe('bounds validation: west > east is legal, south > north is not', () => {
  /**
   * The 20-degree strip over the Pacific, verified against a real PostGIS in
   * ADR §9.3: Fiji (178.44, -18.14) and Samoa (-172, -18) are inside it, and
   * (0, -18), (100, -18), (-100, -18) are not. A fixture set without this box
   * cannot tell a correct validator from one that also rejects `west > east` —
   * every ordinary box has `west < east`, so both implementations agree on all
   * of them.
   */
  const ANTIMERIDIAN: GeoBounds = { west: 170, south: -20, east: -170, north: -16 };
  const ORDINARY: GeoBounds = { west: 2.05, south: 41.32, east: 2.23, north: 41.47 };
  const FLIPPED_LATITUDE: GeoBounds = { west: 2.05, south: 41.47, east: 2.23, north: 41.32 };

  it('accepts an ordinary box', () => {
    expect(isValidBounds(ORDINARY)).toBe(true);
  });

  it('accepts a box crossing the antimeridian', () => {
    expect(isValidBounds(ANTIMERIDIAN)).toBe(true);
  });

  it('rejects a box whose south is north of its north', () => {
    expect(isValidBounds(FLIPPED_LATITUDE)).toBe(false);
  });

  /**
   * The two rules are independent, and this is what proves it: accepting
   * `west > east` must not be a blanket "accept anything reversed". A box that
   * crosses the antimeridian AND has its latitudes flipped is still invalid.
   */
  it('rejects flipped latitudes even on an antimeridian box', () => {
    expect(isValidBounds({ west: 170, south: -16, east: -170, north: -20 })).toBe(false);
  });

  it('accepts a degenerate box', () => {
    // Zero area is a legitimate, if useless, query — not a malformed one.
    expect(isValidBounds({ west: 2.05, south: 41.32, east: 2.05, north: 41.32 })).toBe(true);
  });

  it('rejects a latitude beyond a pole and a longitude beyond the range', () => {
    expect(isValidBounds({ west: 0, south: -91, east: 1, north: 10 })).toBe(false);
    expect(isValidBounds({ west: 0, south: 0, east: 1, north: 91 })).toBe(false);
    expect(isValidBounds({ west: -181, south: 0, east: 1, north: 10 })).toBe(false);
    expect(isValidBounds({ west: 0, south: 0, east: 181, north: 10 })).toBe(false);
  });

  it('rejects a non-finite component', () => {
    expect(isValidBounds({ west: Number.NaN, south: 0, east: 1, north: 10 })).toBe(false);
    expect(isValidBounds({ west: 0, south: 0, east: Number.POSITIVE_INFINITY, north: 10 })).toBe(false);
  });

  it('validates the two coordinate ranges separately', () => {
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90.0001)).toBe(false);
    expect(isValidLatitude(Number.NaN)).toBe(false);
    // 100 is a legal longitude and an illegal latitude — a single shared range
    // check would call this valid.
    expect(isValidLongitude(100)).toBe(true);
    expect(isValidLatitude(100)).toBe(false);
    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(180.03)).toBe(false);
  });
});

describe('normalizeLongitude', () => {
  it('leaves a longitude already in range alone', () => {
    expect(normalizeLongitude(2.1686)).toBe(2.1686);
    expect(normalizeLongitude(-179.97)).toBe(-179.97);
    expect(normalizeLongitude(0)).toBe(0);
  });

  it('normalises the two spellings of the same meridian to one', () => {
    // Half-open range: leaving both legal would give one box two tokens and two
    // cache keys.
    expect(normalizeLongitude(180)).toBe(-180);
    expect(normalizeLongitude(-180)).toBe(-180);
  });

  it('normalises negative zero', () => {
    expect(Object.is(normalizeLongitude(-0), 0)).toBe(true);
  });

  it('wraps a value past the antimeridian', () => {
    // ADR §9.3's concrete bug: `WhereStep` builds a ±0.05° box around a picked
    // point, so at longitude 179.98 the east edge is 180.03 and every place
    // within 0.05° of the antimeridian fails with INVALID_GEO_PARAMS today.
    expect(normalizeLongitude(180.03)).toBeCloseTo(-179.97, 10);
    expect(normalizeLongitude(-180.03)).toBeCloseTo(179.97, 10);
    expect(normalizeLongitude(540)).toBe(-180);
  });

  /**
   * The end-to-end form of the same bug: the synthetic box around a point at
   * 179.98 must serialise, and it must come out as a `west > east` box rather
   * than be refused.
   */
  it('lets a synthetic box across the antimeridian serialise', () => {
    const token = expectOk(
      serializeLocationRef({
        kind: 'bounds',
        bounds: { west: 179.93, south: -18.05, east: 180.03, north: -17.95 },
      }),
    );
    expect(token).toBe('bbox.179.93,-18.05,-179.97,-17.95');
    const reparsed = expectOk(parseLocationToken(token));
    expect(reparsed).toEqual({
      kind: 'bounds',
      bounds: { west: 179.93, south: -18.05, east: -179.97, north: -17.95 },
    });
    // Normalisation is idempotent: the canonical form is a fixed point, or the
    // URL would keep changing on every reload.
    expect(expectOk(serializeLocationRef(reparsed))).toBe(token);
  });

  /**
   * Serialisation must not switch to exponent notation, because the parser
   * refuses it — an unrounded serialiser emits tokens its own parser rejects,
   * and only within about 11 cm of Greenwich or the equator, which is exactly
   * the kind of defect that survives review.
   */
  it('emits a plain decimal for a coordinate close to zero', () => {
    const token = expectOk(
      serializeLocationRef({
        kind: 'bounds',
        bounds: { west: 1e-7, south: 1e-7, east: 0.5, north: 0.5 },
      }),
    );
    expect(token).not.toMatch(/e[+-]/i);
    expect(token).toBe('bbox.0,0,0.5,0.5');
    expect(parseLocationToken(token).ok).toBe(true);
  });
});
