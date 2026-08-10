/**
 * The seven divergence invariants (#350), against the discriminating fixtures.
 *
 * Every case here is chosen so that a correct and an incorrect implementation
 * produce DIFFERENT results. The wrong result each fixture provokes is written
 * beside the fixture itself in
 * `packages/backend/__tests__/helpers/locationIdentityFixtures.ts` and repeated
 * in `docs/qa/location-and-housing-identity-e2e-matrix.md`. A symmetric fixture
 * — two Barcelonas with the same score, a duplicate at the edge of a price
 * distribution, a viewport that does not cross the antimeridian — would pass
 * under both implementations and prove nothing, which is the failure mode this
 * whole file exists to avoid.
 */

import {
  INVARIANT_CODES,
  PUBLIC_PRECISION_MAX_DECIMALS,
  canonicalQueryDescriptor,
  checkGeocoderFallbackScope,
  checkListingHasHousingIdentity,
  checkPublicPrecisionWithinPolicy,
  checkQueryIdentityMatch,
  checkResultIsForCurrentQuery,
  checkVisibleAreaMatchesQueriedArea,
  checkVisibleLabelMatchesSelection,
  decimalPlaces,
  deriveOpaqueRef,
  deriveQueryId,
  priceSpreadBucketPct,
  scanForSensitiveValues,
  type InvariantResult,
} from '@homiio/shared-types';

import {
  ANTIMERIDIAN_COMPLEMENT,
  ANTIMERIDIAN_VIEWPORT,
  BARCELONA_ES,
  BARCELONA_VE,
  DUPLICATE_LISTING_GROUP,
  EXACT_LOCATION,
  FLOAT_NOISE_APPROXIMATION,
  MADRID_ES,
  MIXED_CURRENCY_GROUP,
  PRICE_SAMPLE_WITH_DUPLICATE,
  PUBLIC_APPROXIMATION,
  SAME_BUILDING_UNITS,
  cityQuery,
  viewportQuery,
} from '../helpers/locationIdentityFixtures';

/** Median of a numeric sample. Used only to show that the fixture discriminates. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) return Number.NaN;
  if (sorted.length % 2 === 1) return upper;
  return lower === undefined ? upper : (lower + upper) / 2;
}

describe('invariant results are safe to log', () => {
  it('covers every declared invariant code', () => {
    // A completeness floor: an invariant added to the union without a case here
    // fails rather than silently going untested.
    const exercised: InvariantResult[] = [
      checkQueryIdentityMatch(cityQuery(BARCELONA_ES), cityQuery(BARCELONA_VE)),
      checkVisibleAreaMatchesQueriedArea(BARCELONA_ES.bounds, MADRID_ES.bounds),
      checkVisibleLabelMatchesSelection(
        { renderedFrom: { kind: 'city', countryCode: 'ES', placeKey: BARCELONA_ES.placeKey } },
        { kind: 'city', countryCode: 'ES', placeKey: MADRID_ES.placeKey },
      ),
      checkResultIsForCurrentQuery('0123456789abcdef', 'fedcba9876543210'),
      checkGeocoderFallbackScope('timeout', 'none', 'none'),
      checkPublicPrecisionWithinPolicy(EXACT_LOCATION, 'locality'),
      checkListingHasHousingIdentity({ addressIsCanonical: true, hasHousingIdentity: false }),
    ];

    expect(exercised.map((result) => result.code).sort()).toEqual([...INVARIANT_CODES].sort());
    // Every one of them is a FAILING case, which is what makes the next
    // assertion meaningful: a failure's detail is where a value would leak.
    expect(exercised.every((result) => result.ok === false)).toBe(true);
  });

  it('reports classifications only — never a coordinate, a name or a query', () => {
    const results: InvariantResult[] = [
      checkQueryIdentityMatch(cityQuery(BARCELONA_ES), cityQuery(BARCELONA_VE)),
      checkVisibleAreaMatchesQueriedArea(BARCELONA_ES.bounds, MADRID_ES.bounds),
      checkPublicPrecisionWithinPolicy(EXACT_LOCATION, 'locality'),
      checkGeocoderFallbackScope('error', 'none', 'global'),
    ];

    for (const result of results) {
      // The same sweep the redaction layer runs on an outgoing event, applied
      // to what a production divergence check would log.
      expect(scanForSensitiveValues(result.safe, new Set())).toEqual([]);
    }
  });
});

describe('the query digest is pinned, not recomputed', () => {
  // The SAME descriptor and the SAME expected strings as
  // `packages/frontend/__tests__/observabilityContract.test.ts`. A list on the
  // server and a map on a phone can only be compared if both tiers derive the
  // identifier identically, and the two suites run through different
  // transforms (ts-jest here, Babel there) and resolve the package by different
  // routes (source path mapping here, `dist` there). Pinning the literal in
  // both is what makes a divergence between them a red build rather than a
  // silent false alarm in production.
  const PINNED_QUERY = {
    locationKind: 'city',
    countryCode: 'ES',
    placeKey: 'es-cat-barcelona',
    center: { lat: 41.3874, lng: 2.1686 },
    filters: { bedrooms: 2 },
    sort: 'relevance',
  } as const;

  it('produces the pinned canonical form and id', () => {
    expect(canonicalQueryDescriptor(PINNED_QUERY)).toBe(
      'q1|kind=city|country=ES|place=es-cat-barcelona|center=41.387,2.169|radius=|bounds=|text=|sort=relevance|filters=bedrooms:2',
    );
    expect(deriveQueryId(PINNED_QUERY)).toBe('e795565c163c5c95');
    expect(deriveOpaqueRef('unit', 'unit-4-2')).toBe('5fc3683bd64ae56a');
  });
});

describe('1. list and map must be showing the same query', () => {
  it('separates two cities that share a name', () => {
    const result = checkQueryIdentityMatch(cityQuery(BARCELONA_ES), cityQuery(BARCELONA_VE));

    expect(result.ok).toBe(false);
    // A name-keyed scope would make these identical; the stable place key is
    // the only field that differs in a way an implementation cannot fake.
    expect(deriveQueryId(cityQuery(BARCELONA_ES))).not.toBe(
      deriveQueryId(cityQuery(BARCELONA_VE)),
    );
    expect(canonicalQueryDescriptor(cityQuery(BARCELONA_ES))).toContain(BARCELONA_ES.placeKey);
  });

  it('agrees when two surfaces built the same query independently', () => {
    // The positive control. Without it, an implementation that reports
    // divergence for everything would pass every case above.
    expect(checkQueryIdentityMatch(cityQuery(BARCELONA_ES), cityQuery(BARCELONA_ES)).ok).toBe(
      true,
    );
  });

  it('is stable across float noise inside the published grid cell', () => {
    const nudged = {
      ...cityQuery(BARCELONA_ES),
      center: { lat: BARCELONA_ES.center.lat + 0.00004, lng: BARCELONA_ES.center.lng - 0.00004 },
    };

    // ~4 m, well inside the 3-decimal cell. Two surfaces that disagree at this
    // scale are showing the same query, and a check that fires here is a check
    // people switch off. Stated honestly: this is quantisation, not a
    // tolerance — a pair straddling a cell boundary DOES get two ids, which is
    // why the geometric invariant above works on real numbers instead.
    expect(deriveQueryId(nudged)).toBe(deriveQueryId(cityQuery(BARCELONA_ES)));
  });

  it('catches a city filter that survived a move to another city', () => {
    // The cross-filter leak: the map is over Madrid, and the request still
    // carries Barcelona's city key. Bounds alone would not see this — the two
    // descriptors have the SAME viewport.
    const mapQuery = viewportQuery(MADRID_ES.bounds);
    const listQuery = viewportQuery(MADRID_ES.bounds, { cityKey: BARCELONA_ES.placeKey });

    expect(checkQueryIdentityMatch(listQuery, mapQuery).ok).toBe(false);
    expect(
      checkVisibleAreaMatchesQueriedArea(MADRID_ES.bounds, MADRID_ES.bounds).ok,
    ).toBe(true);
  });

  it('treats free text and geographic scope as separate dimensions', () => {
    // Principle 5 of the epic. Changing either one changes the query, and a
    // digest that folded them together would let a text change silently reuse
    // the previous area's results — or the reverse.
    const inArea = viewportQuery(MADRID_ES.bounds);
    const inAreaWithText = { ...inArea, freeText: 'ático con terraza' };
    const elsewhereWithText = { ...viewportQuery(BARCELONA_ES.bounds), freeText: 'ático con terraza' };

    expect(deriveQueryId(inAreaWithText)).not.toBe(deriveQueryId(inArea));
    expect(deriveQueryId(inAreaWithText)).not.toBe(deriveQueryId(elsewhereWithText));
    // Case and stray whitespace are keyboard noise, not a different search.
    expect(deriveQueryId({ ...inArea, freeText: '  Ático CON terraza ' })).toBe(
      deriveQueryId({ ...inArea, freeText: 'ático con terraza' }),
    );
  });

  it('ignores the order filters were written in', () => {
    const a = viewportQuery(MADRID_ES.bounds, { bedrooms: 2, furnished: true });
    const b = viewportQuery(MADRID_ES.bounds, { furnished: true, bedrooms: 2 });

    expect(deriveQueryId(a)).toBe(deriveQueryId(b));
  });
});

describe('2. the visible area must be the queried area', () => {
  it('rejects a Madrid viewport answered with Barcelona bounds', () => {
    const result = checkVisibleAreaMatchesQueriedArea(MADRID_ES.bounds, BARCELONA_ES.bounds);

    expect(result.ok).toBe(false);
    expect(result.safe.overlapClass).toBe('none');
  });

  it('rejects two cities that share a name and nothing else', () => {
    expect(
      checkVisibleAreaMatchesQueriedArea(BARCELONA_ES.bounds, BARCELONA_VE.bounds).ok,
    ).toBe(false);
  });

  it('accepts an antimeridian viewport compared with itself', () => {
    // `east - west` on this box is -358. An implementation that computes the
    // span that way reads it as empty or as the whole planet, and BOTH readings
    // are silent — the second makes every comparison pass.
    const result = checkVisibleAreaMatchesQueriedArea(
      ANTIMERIDIAN_VIEWPORT,
      ANTIMERIDIAN_VIEWPORT,
    );

    expect(result.ok).toBe(true);
    expect(result.safe.overlapClass).toBe('match');
    expect(result.safe.visibleCrossesAntimeridian).toBe(true);
  });

  it('rejects an antimeridian viewport compared with its complement', () => {
    // Same four numbers, west and east swapped: the rest of the planet. The
    // pair shares not one square degree, so an implementation that treats the
    // box as 358° wide reports a near-perfect match here.
    const result = checkVisibleAreaMatchesQueriedArea(
      ANTIMERIDIAN_VIEWPORT,
      ANTIMERIDIAN_COMPLEMENT,
    );

    expect(result.ok).toBe(false);
    expect(result.safe.overlapClass).toBe('none');
  });

  it('tolerates a nudged viewport', () => {
    const nudged = {
      west: BARCELONA_ES.bounds.west + 0.005,
      south: BARCELONA_ES.bounds.south + 0.005,
      east: BARCELONA_ES.bounds.east + 0.005,
      north: BARCELONA_ES.bounds.north + 0.005,
    };

    expect(checkVisibleAreaMatchesQueriedArea(nudged, BARCELONA_ES.bounds).ok).toBe(true);
  });
});

describe('3. the visible label must describe the current selection', () => {
  it('catches a header still reading Barcelona while Madrid is selected', () => {
    const result = checkVisibleLabelMatchesSelection(
      { renderedFrom: { kind: 'city', countryCode: 'ES', placeKey: BARCELONA_ES.placeKey } },
      { kind: 'city', countryCode: 'ES', placeKey: MADRID_ES.placeKey },
    );

    expect(result.ok).toBe(false);
    expect(result.safe.placeMatch).toBe(false);
    // Same kind, same country — only the place differs, which is exactly the
    // case a coarse "is a location selected?" check would pass.
    expect(result.safe.kindMatch).toBe(true);
    expect(result.safe.countryMatch).toBe(true);
  });

  it('accepts a label rendered from the current selection', () => {
    const scope = { kind: 'city', countryCode: 'ES', placeKey: BARCELONA_ES.placeKey } as const;
    expect(checkVisibleLabelMatchesSelection({ renderedFrom: scope }, scope).ok).toBe(true);
  });
});

describe('4. a result must answer the query that is current', () => {
  it('flags a result for a superseded query', () => {
    const first = deriveQueryId(cityQuery(BARCELONA_ES));
    const second = deriveQueryId(cityQuery(MADRID_ES));

    expect(checkResultIsForCurrentQuery(first, second).ok).toBe(false);
    expect(checkResultIsForCurrentQuery(second, second).ok).toBe(true);
  });
});

describe('5. a geocoder failure must never widen the scope to the world', () => {
  const failures = ['timeout', 'rate_limited', 'error', 'empty'] as const;

  it.each(failures)('refuses an unscoped search after a %s', (outcome) => {
    // The silent shape: no fallback was "applied", the scope simply never
    // existed, and the result reads as an ordinary unfiltered browse.
    expect(checkGeocoderFallbackScope(outcome, 'none', 'none').ok).toBe(false);
  });

  it('refuses a worldwide fallback even when the geocoder succeeded', () => {
    expect(checkGeocoderFallbackScope('ok', 'city', 'global').ok).toBe(false);
  });

  it('accepts a widened radius after a failure — a narrower scope is still a scope', () => {
    const result = checkGeocoderFallbackScope('timeout', 'radius', 'widened_radius');

    expect(result.ok).toBe(true);
    expect(result.safe.worldwideFallback).toBe(false);
  });

  it('accepts the ordinary success path', () => {
    expect(checkGeocoderFallbackScope('ok', 'city', 'none').ok).toBe(true);
  });
});

describe('6. published precision must not exceed the policy', () => {
  it('refuses an exact location published at locality precision', () => {
    const result = checkPublicPrecisionWithinPolicy(EXACT_LOCATION, 'locality');

    expect(result.ok).toBe(false);
    expect(result.safe.observedDecimals).toBe(5);
    expect(result.safe.allowedDecimals).toBe(PUBLIC_PRECISION_MAX_DECIMALS.locality);
  });

  it('accepts the approximation of the same place', () => {
    // Renders identically at any zoom a person looks at. Only the decimal count
    // tells them apart, which is why nothing but this check catches it.
    expect(checkPublicPrecisionWithinPolicy(PUBLIC_APPROXIMATION, 'locality').ok).toBe(true);
  });

  it('catches float noise from a rounding that looked correct', () => {
    const result = checkPublicPrecisionWithinPolicy(FLOAT_NOISE_APPROXIMATION, 'locality');

    expect(result.ok).toBe(false);
    expect(result.safe.observedDecimals).toBeGreaterThan(5);
  });

  it('counts decimals in exponent notation, where a naive scan reports zero', () => {
    expect(decimalPlaces(1e-7)).toBe(7);
    expect(decimalPlaces(41.38743)).toBe(5);
    expect(decimalPlaces(41)).toBe(0);
  });

  it('permits unit precision where the policy allows it', () => {
    expect(checkPublicPrecisionWithinPolicy(EXACT_LOCATION, 'unit').ok).toBe(true);
  });
});

describe('7. a listing on a canonical address must carry its housing identity', () => {
  it('flags an unlinked listing on a materialised address', () => {
    expect(
      checkListingHasHousingIdentity({ addressIsCanonical: true, hasHousingIdentity: false }).ok,
    ).toBe(false);
  });

  it('permits an unlinked listing whose address is still a candidate', () => {
    // Before materialisation there is nothing to link to, so requiring a link
    // would fail every freshly ingested external listing.
    expect(
      checkListingHasHousingIdentity({ addressIsCanonical: false, hasHousingIdentity: false }).ok,
    ).toBe(true);
  });
});

describe('housing identity fixtures discriminate', () => {
  it('keeps two units of one building apart', () => {
    const [ground, fourth] = SAME_BUILDING_UNITS;

    const groundRef = deriveOpaqueRef('unit', ground.unitKey);
    const fourthRef = deriveOpaqueRef('unit', fourth.unitKey);
    const buildingRef = deriveOpaqueRef('building', ground.buildingKey);

    // An implementation keyed on the BUILDING gives these two the same
    // reference and averages a 2 and a 5 into a 3.5 that describes neither home.
    expect(groundRef).not.toBe(fourthRef);
    expect(deriveOpaqueRef('building', fourth.buildingKey)).toBe(buildingRef);
    expect(Math.abs(ground.reviewScore - fourth.reviewScore)).toBeGreaterThanOrEqual(3);
  });

  it('collapses three portal listings of one flat into one group', () => {
    const unitKeys = new Set(DUPLICATE_LISTING_GROUP.map((listing) => listing.unitKey));
    const listingKeys = new Set(DUPLICATE_LISTING_GROUP.map((listing) => listing.listingKey));

    // Grouping on the listing id gives three groups of one; grouping on the
    // dwelling gives one group of three.
    expect(listingKeys.size).toBe(3);
    expect(unitKeys.size).toBe(1);
  });

  it('changes the neighbourhood median when the duplicate is counted three times', () => {
    const everyListing = PRICE_SAMPLE_WITH_DUPLICATE.map((listing) => listing.price.amount);

    const lowestPerDwelling = new Map<string, number>();
    for (const listing of PRICE_SAMPLE_WITH_DUPLICATE) {
      const seen = lowestPerDwelling.get(listing.unitKey);
      if (seen === undefined || listing.price.amount < seen) {
        lowestPerDwelling.set(listing.unitKey, listing.price.amount);
      }
    }

    expect(median(everyListing)).toBe(1225);
    expect(median([...lowestPerDwelling.values()])).toBe(1125);
  });

  it('refuses to state a price spread across currencies', () => {
    // Every amount is 1 200, so a naive spread reports 0%. The gap between
    // 1 200 PLN and 1 200 USD is roughly fourfold, and the honest answer is the
    // absence of a number rather than a converted one.
    expect(priceSpreadBucketPct(MIXED_CURRENCY_GROUP)).toBeUndefined();
  });

  it('states the spread when the group is comparable', () => {
    // 1 200 → 1 290 is 7.5%.
    expect(priceSpreadBucketPct(DUPLICATE_LISTING_GROUP.map((listing) => listing.price))).toBe(
      '5-15',
    );
  });
});
