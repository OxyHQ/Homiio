/**
 * The geographic selection is ATOMIC.
 *
 * "Old city + new bounds" is the single largest source of wrong results this
 * contract exists to remove, and the fix is not a careful call site — it is
 * that no action in the store accepts less than a whole `LocationSelection`.
 * These tests assert the RESULTING SELECTION rather than any request, because
 * the store is where the combination becomes unrepresentable; the request-level
 * consequences are pinned in `buildSearchParams.test.ts`.
 *
 * ## What a wrong implementation produces, and why a naive test misses it
 *
 * Reintroduce a shallow patch — `patchQuery({ location: { ...old, bounds } })`
 * — and every one of these keeps passing IF it only checks that the new bounds
 * arrived. They do arrive. What changes is that the OLD identity survives
 * beside them, so each case below asserts on the ABSENCE of the previous
 * selection's id, label and centre, not on the presence of the new box.
 */
import { OfferingType, locationKey, type LocationSelection } from '@homiio/shared-types';

import { DEFAULT_SEARCH_QUERY, useSearchQueryStore } from '@/store/searchQueryStore';

const BARCELONA_ID = '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA';

const barcelona: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: BARCELONA_ID },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
  center: { longitude: 2.1734, latitude: 41.3851 },
  bounds: { west: 2.05, south: 41.32, east: 2.23, north: 41.47 },
  precision: 'centroid',
};

const MADRID = { west: -3.75, south: 40.38, east: -3.65, north: 40.45 };

beforeEach(() => {
  useSearchQueryStore.setState({
    query: DEFAULT_SEARCH_QUERY,
    pendingViewport: null,
  });
});

describe('committing map bounds over a place', () => {
  it('leaves NO trace of the previous place', () => {
    const store = useSearchQueryStore.getState();
    store.commitLocation(barcelona);
    useSearchQueryStore.getState().setPendingViewport(MADRID);
    useSearchQueryStore.getState().commitPendingViewport();

    const selection = useSearchQueryStore.getState().query.location;
    expect(selection).not.toBeNull();
    if (!selection) throw new Error('unreachable');

    // The kind itself changed — a merge would have kept `place`.
    expect(selection.kind).toBe('map_bounds');
    // No id, no label, no old centre. Serialising and scanning catches a
    // remnant that survived under a different field name, which a per-field
    // check would not.
    const serialised = JSON.stringify(selection);
    expect(serialised).not.toContain(BARCELONA_ID);
    expect(serialised).not.toContain('Catalonia');
    expect(serialised).not.toContain('2.1734');
    // …and the new box really is committed, so the assertions above are not
    // passing merely because the location was cleared.
    expect(selection.kind === 'map_bounds' && selection.bounds).toEqual(MADRID);
  });

  it('re-keys the query, so the results cannot be served from the old entry', () => {
    useSearchQueryStore.getState().commitLocation(barcelona);
    const before = locationKey(useSearchQueryStore.getState().query.location);

    useSearchQueryStore.getState().setPendingViewport(MADRID);
    useSearchQueryStore.getState().commitPendingViewport();
    const after = locationKey(useSearchQueryStore.getState().query.location);

    expect(before).toBe(`homiio:city:${BARCELONA_ID}`);
    expect(after).not.toBe(before);
  });

  it('does NOT touch the free text, which is a different dimension', () => {
    useSearchQueryStore.getState().setQueryText('loft with terrace');
    useSearchQueryStore.getState().commitLocation(barcelona);
    useSearchQueryStore.getState().setPendingViewport(MADRID);
    useSearchQueryStore.getState().commitPendingViewport();

    expect(useSearchQueryStore.getState().query.queryText).toBe('loft with terrace');
  });
});

describe('committing a place over map bounds', () => {
  it('leaves NO old bounds behind', () => {
    useSearchQueryStore.getState().setPendingViewport(MADRID);
    useSearchQueryStore.getState().commitPendingViewport();
    useSearchQueryStore.getState().commitLocation(barcelona);

    const selection = useSearchQueryStore.getState().query.location;
    expect(selection?.kind).toBe('place');
    // Barcelona's OWN bounds may be present; Madrid's must not be.
    expect(JSON.stringify(selection)).not.toContain('-3.75');
  });
});

describe('a pending viewport is not a query', () => {
  it('changes nothing about the committed query until it is confirmed', () => {
    useSearchQueryStore.getState().commitLocation(barcelona);
    const before = useSearchQueryStore.getState().query;

    useSearchQueryStore.getState().setPendingViewport(MADRID);

    // Panning the map must not move the results, the request or the URL.
    expect(useSearchQueryStore.getState().query).toBe(before);
    expect(useSearchQueryStore.getState().pendingViewport).toEqual(MADRID);
  });

  it('is discarded when the selection changes by any other route', () => {
    useSearchQueryStore.getState().setPendingViewport(MADRID);
    useSearchQueryStore.getState().commitLocation(barcelona);

    // A box over the map the user has since navigated away from can never be
    // committed — otherwise pressing "Search this area" after picking a city
    // would silently apply the OLD viewport.
    expect(useSearchQueryStore.getState().pendingViewport).toBeNull();
  });

  it('does nothing when confirmed with no pending box', () => {
    useSearchQueryStore.getState().commitLocation(barcelona);
    const before = useSearchQueryStore.getState().query;

    useSearchQueryStore.getState().commitPendingViewport();

    expect(useSearchQueryStore.getState().query).toBe(before);
  });
});

describe('the filter patch cannot reach the geographic dimension', () => {
  it('leaves the location untouched when filters change', () => {
    useSearchQueryStore.getState().commitLocation(barcelona);

    useSearchQueryStore.getState().patchFilters({ priceMax: 1400, bedrooms: 2 });

    const { query } = useSearchQueryStore.getState();
    expect(query.priceMax).toBe(1400);
    expect(query.location).toEqual(barcelona);
  });

  it('preserves location and text across an offering switch', () => {
    // Someone looking at Barcelona who switches to vacation still means
    // Barcelona. Only the per-offering dimensions (price, dates, guests) reset.
    useSearchQueryStore.getState().commitLocation(barcelona);
    useSearchQueryStore.getState().setQueryText('loft');
    useSearchQueryStore.getState().setPriceRange(500, 1400);

    useSearchQueryStore.getState().setOffering(OfferingType.SHORT_TERM_RENT);

    const { query } = useSearchQueryStore.getState();
    expect(query.location).toEqual(barcelona);
    expect(query.queryText).toBe('loft');
    expect(query.priceMin).toBeUndefined();
    expect(query.priceMax).toBeUndefined();
  });
});

describe('clearing', () => {
  it('drops the location and any pending viewport together', () => {
    useSearchQueryStore.getState().commitLocation(barcelona);
    useSearchQueryStore.getState().setPendingViewport(MADRID);

    useSearchQueryStore.getState().clearLocation();

    expect(useSearchQueryStore.getState().query.location).toBeNull();
    expect(useSearchQueryStore.getState().pendingViewport).toBeNull();
  });

  it('treats whitespace-only text as absence, not as a search for nothing', () => {
    useSearchQueryStore.getState().setQueryText('   ');
    expect(useSearchQueryStore.getState().query.queryText).toBeNull();
  });
});
