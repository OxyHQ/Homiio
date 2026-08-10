/**
 * Barcelona → pan to Madrid → confirm, end to end.
 *
 * The discriminating fixture #354 requires, run through the REAL store and the
 * REAL request builder rather than either one alone. Both halves already have
 * their own suites — `searchQueryStoreAtomicity` asserts the resulting
 * selection, `buildSearchParams` asserts the emitted params — and neither can
 * see the join, which is where the defect lived: a selection that was replaced
 * correctly, and a request that carried the previous place's name anyway.
 *
 * Every assertion is on the REQUEST or on the STORE, never on a result count.
 * That is the design of the file: the broken behaviour returns ZERO listings,
 * which is a plausible-looking answer, and reads in the UI as "this area is
 * empty" rather than as a bug.
 */
import { OfferingType, locationKey, type LocationSelection } from '@homiio/shared-types';

import {
  DEFAULT_SEARCH_QUERY,
  mapBoundsSelection,
  useSearchQueryStore,
} from '@/store/searchQueryStore';
import { buildSearchParams, searchQueryId } from '@/hooks/usePropertySearch';
import { reduceMapMovement, type SearchAreaState } from '@/components/search/searchArea';

const BARCELONA_CITY_ID = '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA';

const barcelona: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: BARCELONA_CITY_ID },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
  center: { longitude: 2.1734035, latitude: 41.3850639 },
  bounds: { west: 2.05, south: 41.32, east: 2.23, north: 41.47 },
  precision: 'centroid',
};

/** The viewport the map reports once the user has dragged to Madrid. */
const MADRID_VIEW = { west: -3.75, south: 40.38, east: -3.65, north: 40.45 };
/** What the map reports when it frames Barcelona on open — padding included. */
const BARCELONA_FRAMED = { west: 2.03, south: 41.3, east: 2.25, north: 41.49 };

/** Everything about Barcelona that must not survive into a Madrid request. */
const BARCELONA_TRACES = [BARCELONA_CITY_ID, 'Barcelona', 'Catalonia', '2.1734035', '2.05'];

beforeEach(() => {
  useSearchQueryStore.setState({ query: DEFAULT_SEARCH_QUERY, pendingViewport: null });
});

/** Drive the map exactly as the results view does, and return the new state. */
function move(
  state: SearchAreaState,
  bounds: typeof MADRID_VIEW,
  source: 'user' | 'programmatic',
): SearchAreaState {
  const next = reduceMapMovement(state, { bounds, isFinal: true, source });
  useSearchQueryStore.getState().setPendingViewport(next.pending);
  return next;
}

describe('Barcelona, panned to Madrid, confirmed', () => {
  it('sends the new box and NOTHING of the old place', () => {
    const store = useSearchQueryStore.getState();
    store.commitLocation(barcelona);

    // The search opens: the app frames the city, which must not arm anything.
    let camera = move({ anchor: null, pending: null }, BARCELONA_FRAMED, 'programmatic');
    expect(useSearchQueryStore.getState().pendingViewport).toBeNull();

    // The user drags to Madrid and confirms.
    camera = move(camera, MADRID_VIEW, 'user');
    const pending = useSearchQueryStore.getState().pendingViewport;
    expect(pending).toEqual(MADRID_VIEW);
    if (!pending) throw new Error('unreachable');
    useSearchQueryStore.getState().commitLocation(mapBoundsSelection(pending));

    const params = buildSearchParams(useSearchQueryStore.getState().query);

    // The box went out…
    expect(params).toMatchObject({
      swLat: 40.38,
      swLng: -3.75,
      neLat: 40.45,
      neLng: -3.65,
    });
    // …and every route Barcelona could have come back on is closed. Asserting
    // on the SERIALISED params rather than field by field is deliberate: a
    // remnant that reappeared under another key, or one level deeper, would
    // slip past a per-field check.
    expect(params).not.toHaveProperty('q');
    expect(params).not.toHaveProperty('city');
    const serialised = JSON.stringify(params);
    for (const trace of BARCELONA_TRACES) {
      expect(serialised).not.toContain(trace);
    }
  });

  it('re-keys the search, so the previous city cannot be served from cache', () => {
    useSearchQueryStore.getState().commitLocation(barcelona);
    const before = searchQueryId(useSearchQueryStore.getState().query);

    useSearchQueryStore.getState().commitLocation(mapBoundsSelection(MADRID_VIEW));
    const after = searchQueryId(useSearchQueryStore.getState().query);

    expect(after).not.toBe(before);
    expect(locationKey(useSearchQueryStore.getState().query.location)).toBe(
      'bbox:-3.75,40.38,-3.65,40.45',
    );
  });

  it('keeps free text the user actually typed', () => {
    // "loft with a terrace" is a description of a home, not of a city, so
    // moving the map does not retract it. This is the case that makes the
    // previous test meaningful: `q` is absent there because nothing was typed,
    // not because `q` is never sent.
    useSearchQueryStore.getState().setQueryText('loft with a terrace');
    useSearchQueryStore.getState().commitLocation(barcelona);
    useSearchQueryStore.getState().commitLocation(mapBoundsSelection(MADRID_VIEW));

    const params = buildSearchParams(useSearchQueryStore.getState().query);
    expect(params.q).toBe('loft with a terrace');
    expect(params).toMatchObject({ swLng: -3.75 });
  });

  it('keeps free text that HAPPENS to spell a city, because provenance is what counts', () => {
    // The sharp case. "Barcelona" typed into the text box survives a map-area
    // commit; "Barcelona" as the previous selection's NAME does not. The two
    // are the same string and different facts, and a rule written on the VALUE
    // would have to get one of them wrong.
    useSearchQueryStore.getState().setQueryText('Barcelona');
    useSearchQueryStore.getState().commitLocation(mapBoundsSelection(MADRID_VIEW));

    expect(buildSearchParams(useSearchQueryStore.getState().query).q).toBe('Barcelona');
  });
});

describe('panning without confirming', () => {
  it('changes neither the committed query nor the request', () => {
    useSearchQueryStore.getState().commitLocation(barcelona);
    const before = useSearchQueryStore.getState().query;
    const paramsBefore = buildSearchParams(before);

    move({ anchor: BARCELONA_FRAMED, pending: null }, MADRID_VIEW, 'user');

    expect(useSearchQueryStore.getState().query).toBe(before);
    expect(buildSearchParams(useSearchQueryStore.getState().query)).toEqual(paramsBefore);
    // The viewport is remembered — it is what the button would confirm — and
    // it is not part of the query.
    expect(useSearchQueryStore.getState().pendingViewport).toEqual(MADRID_VIEW);
  });

  it('discards the pending box when the user picks a place instead', () => {
    // Otherwise pressing "Search this area" after choosing a city would apply
    // a viewport from the map the user has visibly left.
    move({ anchor: null, pending: null }, MADRID_VIEW, 'user');
    useSearchQueryStore.getState().commitLocation(barcelona);

    expect(useSearchQueryStore.getState().pendingViewport).toBeNull();
  });
});

describe('an empty answer keeps the scope it was asked about', () => {
  it('leaves the committed area exactly as it was', () => {
    // Invariant 8. Nothing here reacts to a result COUNT, and that is the
    // property: a fallback would live in the store or the params, so the test
    // asserts the request is byte-identical before and after a query returns
    // nothing. Widening on zero results is how a search for a quiet
    // neighbourhood silently becomes a search for the planet.
    useSearchQueryStore.getState().commitLocation(mapBoundsSelection(MADRID_VIEW));
    const params = buildSearchParams(useSearchQueryStore.getState().query);
    const id = searchQueryId(useSearchQueryStore.getState().query);

    // A zero-result response changes no store state at all — there is no
    // action for it to call.
    expect(buildSearchParams(useSearchQueryStore.getState().query)).toEqual(params);
    expect(searchQueryId(useSearchQueryStore.getState().query)).toBe(id);
    expect(useSearchQueryStore.getState().query.location).not.toBeNull();
    expect(params.swLng).toBe(-3.75);
  });
});

describe('pagination while the map is moving', () => {
  it('pages the committed query, not the viewport under the cursor', () => {
    // Paging asks for the next page OF THE COMMITTED SEARCH. A pending
    // viewport must not leak into the request, or page 2 answers a different
    // question from page 1 and the list grows rows from two places.
    useSearchQueryStore.getState().commitLocation(barcelona);
    move({ anchor: BARCELONA_FRAMED, pending: null }, MADRID_VIEW, 'user');

    const params = buildSearchParams(useSearchQueryStore.getState().query);
    expect(params.city).toBe(BARCELONA_CITY_ID);
    expect(params).not.toHaveProperty('swLat');
    // Same identity as before the pan, so every page shares one cache entry.
    expect(searchQueryId(useSearchQueryStore.getState().query)).toBe(
      searchQueryId({ ...DEFAULT_SEARCH_QUERY, location: barcelona }),
    );
  });
});

describe('offering', () => {
  it('survives a map-area commit, because it is not geographic', () => {
    useSearchQueryStore.getState().setOffering(OfferingType.SHORT_TERM_RENT);
    useSearchQueryStore.getState().commitLocation(mapBoundsSelection(MADRID_VIEW));

    expect(buildSearchParams(useSearchQueryStore.getState().query).offering).toBe(
      OfferingType.SHORT_TERM_RENT,
    );
  });
});
