/**
 * URL → store → API params → URL, and the legacy inbound params.
 *
 * ## Why the round trip is asserted character-for-character
 *
 * "Two spellings of the same search" is not a cosmetic problem. React Query
 * keys off the built params, so a query that serialises to two different URLs
 * splits its own cache — and a URL that does not survive a round trip cannot be
 * shared, bookmarked or restored by Back, which is the entire reason the URL
 * became authoritative. Asserting `toEqual` on a param OBJECT would miss both:
 * it is insensitive to the ordering and to the exact token spelling that make
 * the two URLs one string.
 *
 * ## And why "an unparseable token" gets its own case
 *
 * The single most damaging shape in the old code was a failed location falling
 * through to "no location" and running the query unrestricted. A parser that
 * returned `null` for both "absent" and "broken" makes that failure the DEFAULT
 * rather than a bug — so the discriminated result is asserted directly, and the
 * two are checked to be different variants rather than merely both falsy.
 */
import {
  OfferingType,
  PropertyType,
  locationKey,
  type LocationSelection,
} from '@homiio/shared-types';

import {
  buildSearchParamsForUrl,
  exploreHref,
  isNavigationChange,
  parseSearchParams,
} from '@/utils/searchUrl';
import { DEFAULT_SEARCH_QUERY } from '@/store/searchQueryStore';
import type { SearchQuery } from '@/components/search/types';

function query(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return { ...DEFAULT_SEARCH_QUERY, ...overrides };
}

const barcelona: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
  center: { longitude: 2.1734, latitude: 41.3851 },
  precision: 'centroid',
};

const madridBox: LocationSelection = {
  kind: 'map_bounds',
  bounds: { west: -3.75, south: 40.38, east: -3.65, north: 40.45 },
  center: { longitude: -3.7, latitude: 40.415 },
  label: { primary: 'search.summary.mapArea', kind: 'generated' },
  precision: 'area',
};

const deviceLens: LocationSelection = {
  kind: 'current_location',
  center: { longitude: 2.1734, latitude: 41.3851 },
  radiusMeters: 25_000,
  precision: 'exact',
};

/**
 * Two areas at once — the one kind with a genuinely distinct codec path.
 *
 * `multi.` is recursive: it splits on `+`, parses each member, and refuses a
 * nested `multi.`. Leaving it out of a suite titled "every kind" meant the
 * whole of that path — including the order asymmetry below — was untested while
 * the title said otherwise.
 */
const multiArea: LocationSelection = {
  kind: 'multi_area',
  areas: [barcelona, madridBox],
  label: { primary: 'search.summary.multiArea', kind: 'generated' },
};

const externalCandidate: LocationSelection = {
  kind: 'address_candidate',
  source: { kind: 'external', provider: 'osm', ref: 'R349036' },
  label: { primary: 'Carrer de Mallorca 401', kind: 'place' },
  admin: { countryCode: 'ES' },
  center: { longitude: 2.1744, latitude: 41.4036 },
  precision: 'approximate',
};

describe('the `loc` token round-trips for every kind that HAS a token', () => {
  // The qualifier is load-bearing. `polygon` has no §5.2 production at all
  // (§2.1 reserves the wire format), so "every kind" would be a false claim —
  // and a false claim in a describe is the sentence a later maintainer trusts
  // instead of re-checking. Its deliberate non-round-trip is asserted below.
  it.each<[string, LocationSelection, string]>([
    ['a canonical Homiio city', barcelona, 'city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA'],
    ['a confirmed map viewport', madridBox, 'bbox.-3.75,40.38,-3.65,40.45'],
    ['a device lens, with NO coordinates', deviceLens, 'here.25000'],
    ['an external address candidate', externalCandidate, 'address.osm.R349036'],
    [
      'several areas at once',
      multiArea,
      'multi.city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA+bbox.-3.75,40.38,-3.65,40.45',
    ],
  ])('%s', (_label, selection, expectedToken) => {
    // Serialise…
    const params = buildSearchParamsForUrl(query({ location: selection }));
    expect(params.loc).toBe(expectedToken);

    // …and read it back to the SAME token. Comparing the token string rather
    // than a re-derived selection is the point: a parser that normalised
    // `-3.75` to `-3.750` would round-trip a value and not a URL.
    const reparsed = parseSearchParams({ loc: params.loc });
    expect(reparsed.location.kind).toBe('ref');
    if (reparsed.location.kind !== 'ref') throw new Error('unreachable');
    expect(reparsed.location.token).toBe(expectedToken);
  });

  it('never puts the device fix in the URL', () => {
    const params = buildSearchParamsForUrl(query({ location: deviceLens }));
    const url = exploreHref(query({ location: deviceLens }));

    // `here.` carries a radius and nothing else. A shared "near me" link means
    // near THE OPENER, which is both the private reading and the useful one.
    expect(params.loc).toBe('here.25000');
    expect(url).not.toContain('41.3851');
    expect(url).not.toContain('2.1734');
  });

  it('round-trips the whole query, filters included, to the same string', () => {
    const original = query({
      location: barcelona,
      queryText: 'loft with terrace',
      offering: OfferingType.SALE,
      propertyTypes: [PropertyType.APARTMENT],
      priceMax: 1400,
      amenities: ['wifi', 'parking'],
      bedrooms: 2,
    });

    const first = exploreHref(original);
    const parsed = parseSearchParams(
      Object.fromEntries(new URL(`https://x${first}`).searchParams.entries()),
    );

    // The parsed query carries no `location` — a URL holds a token to RESOLVE,
    // never a resolved selection — so the location is put back before
    // re-serialising, which is exactly what the screen does after resolving.
    const second = exploreHref({ ...parsed.query, location: barcelona });

    expect(second).toBe(first);
  });
});

describe('multi-area: order is preserved in the URL and SORTED in the key', () => {
  // Deliberately different, and both directions are asserted because the two
  // requirements pull opposite ways: §16(1) wants an exact URL round trip, so
  // the token keeps the user's order; §3.1 wants an order-INDEPENDENT identity,
  // so the key sorts. A codec that sorted both would break the round trip, and
  // one that sorted neither would give the same two areas two cache entries.
  const reversed: LocationSelection = {
    kind: 'multi_area',
    areas: [madridBox, barcelona],
    label: { primary: 'search.summary.multiArea', kind: 'generated' },
  };

  it('keeps member order in the token, so the URL round-trips exactly', () => {
    const forward = buildSearchParamsForUrl(query({ location: multiArea })).loc;
    const backward = buildSearchParamsForUrl(query({ location: reversed })).loc;

    expect(forward).toBe(
      'multi.city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA+bbox.-3.75,40.38,-3.65,40.45',
    );
    expect(backward).toBe(
      'multi.bbox.-3.75,40.38,-3.65,40.45+city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA',
    );
    expect(forward).not.toBe(backward);
  });

  it('gives the two orderings ONE cache key, because they are one query', () => {
    expect(locationKey(multiArea)).toBe(locationKey(reversed));
  });

  it('refuses a nested multi rather than flattening it', () => {
    // Flattening would round-trip to a DIFFERENT token than it was given, which
    // is the one thing the URL contract cannot allow.
    const parsed = parseSearchParams({ loc: 'multi.multi.city.homiio.a+city.homiio.b+city.homiio.c' });
    expect(parsed.location.kind).toBe('invalid');
  });
});

describe('a polygon deliberately has no token, and does not degrade to its box', () => {
  it('omits `loc` entirely rather than emitting the bounding box', () => {
    const polygon: LocationSelection = {
      kind: 'polygon',
      polygon: {
        type: 'Polygon',
        coordinates: [[[2.0, 41.3], [2.3, 41.3], [2.3, 41.5], [2.0, 41.5], [2.0, 41.3]]],
      },
      bounds: { west: 2.0, south: 41.3, east: 2.3, north: 41.5 },
      label: { primary: 'search.summary.drawnArea', kind: 'generated' },
      precision: 'area',
    };

    const params = buildSearchParamsForUrl(query({ location: polygon, queryText: 'loft' }));

    // Falling back to `bbox.` would silently swap a drawn area for a rectangle
    // that CONTAINS it — a superset, so it over-returns rather than failing,
    // which is the quiet direction. The rest of the query still serialises.
    expect(params).not.toHaveProperty('loc');
    expect(params.q).toBe('loft');
  });
});

describe('free text and location are separate params', () => {
  it('puts typed text in `q` and the place in `loc`', () => {
    const params = buildSearchParamsForUrl(
      query({ location: barcelona, queryText: 'loft with terrace' }),
    );

    expect(params.q).toBe('loft with terrace');
    expect(params.loc).toBe('city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA');
  });

  it('emits no `q` at all for a place with no typed text', () => {
    const params = buildSearchParamsForUrl(query({ location: barcelona }));
    expect(params).not.toHaveProperty('q');
  });

  it('reads `q` back as text and NOT as a location', () => {
    const parsed = parseSearchParams({ q: 'apartamento luminoso' });

    expect(parsed.query.queryText).toBe('apartamento luminoso');
    // Free text is not a place. It used to be geocoded on arrival, which is how
    // typing a word silently became a place search somewhere else.
    expect(parsed.location.kind).toBe('none');
  });
});

describe('legacy inbound params (accepted for one release)', () => {
  it('accepts `?city=` as a request to RESOLVE, not as a resolved place', () => {
    const parsed = parseSearchParams({ city: 'barcelona' });

    expect(parsed.location).toEqual({ kind: 'legacy_city', value: 'barcelona' });
    expect(parsed.needsNormalising).toBe(true);
    // Nothing is committed yet: several matches must open the disambiguation
    // list rather than auto-picking, which is only possible if the parser hands
    // back the request rather than an answer.
    expect(parsed.query.location).toBeNull();
  });

  it('turns `?query=` into `q` VERBATIM and does not geocode it', () => {
    const parsed = parseSearchParams({ query: 'Barcelona' });

    expect(parsed.query.queryText).toBe('Barcelona');
    expect(parsed.location.kind).toBe('none');
    expect(parsed.needsNormalising).toBe(true);
  });

  it('prefers a modern `loc` over a legacy `city` when both are present', () => {
    const parsed = parseSearchParams({
      loc: 'city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA',
      city: 'madrid',
    });

    expect(parsed.location.kind).toBe('ref');
  });

  it('marks nothing as needing normalisation for an already-modern URL', () => {
    const parsed = parseSearchParams({ loc: 'bbox.-3.75,40.38,-3.65,40.45', q: 'loft' });
    expect(parsed.needsNormalising).toBe(false);
  });
});

describe('an unreadable `loc` is a failure, never an absence', () => {
  it.each([
    ['an unknown kind', 'planet.homiio.mars'],
    ['a malformed place token', 'city.homiio.'],
    ['a bbox with a non-number', 'bbox.-3.75,forty,-3.65,40.45'],
    ['a bbox with too few parts', 'bbox.-3.75,40.38,-3.65'],
    ['a latitude out of range', 'bbox.-3.75,-91,-3.65,40.45'],
    ['an inverted latitude order', 'bbox.-3.75,40.45,-3.65,40.38'],
    ['a non-positive radius', 'here.0'],
  ])('reports %s as invalid rather than as no location', (_label, token) => {
    const parsed = parseSearchParams({ loc: token });

    expect(parsed.location.kind).toBe('invalid');
    // The discriminator that matters: `invalid` and `none` are different
    // variants, so a caller cannot treat a broken token as an absent one and
    // fall through to a global feed.
    expect(parsed.location.kind).not.toBe('none');
  });

  it('reports a genuinely absent `loc` as `none`, so the two are distinguishable', () => {
    expect(parseSearchParams({}).location.kind).toBe('none');
  });

  it('accepts an antimeridian-crossing box, where west > east', () => {
    // The box `170 → -170` is the 20-degree Pacific strip. A validator that
    // "tidied up" the ordering would reject it here, and every antimeridian
    // search would 400.
    const parsed = parseSearchParams({ loc: 'bbox.170,-20,-170,-16' });

    expect(parsed.location.kind).toBe('ref');
    if (parsed.location.kind !== 'ref') throw new Error('unreachable');
    expect(parsed.location.ref).toEqual({
      kind: 'bounds',
      bounds: { west: 170, south: -20, east: -170, north: -16 },
    });
  });
});

describe('navigation vs refinement', () => {
  it('treats a location change as a navigation (push, so Back works)', () => {
    expect(isNavigationChange(query({ location: barcelona }), query({ location: madridBox }))).toBe(
      true,
    );
  });

  it('treats a filter change as a refinement (replace, so Back is not buried)', () => {
    expect(
      isNavigationChange(
        query({ location: barcelona, priceMax: 1000 }),
        query({ location: barcelona, priceMax: 1400 }),
      ),
    ).toBe(false);
  });

  it('treats committing a location where there was none as a navigation', () => {
    expect(isNavigationChange(query(), query({ location: barcelona }))).toBe(true);
  });
});
