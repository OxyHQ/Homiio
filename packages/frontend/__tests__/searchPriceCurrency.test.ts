/**
 * A price bound and its unit are ONE answer (#518 §6, #519 §6.1).
 *
 * The filter used to be a bare number. The backend compared it against every
 * listing's own price whatever it was advertised in, so `priceMax=1200`
 * returned homes at £1,100 — about €1,290 — on a page whose maximum was 1,200.
 * The fix is a currency that travels with the bound, and this file pins the
 * client half of it: what is emitted, what is written into a link, and — the
 * part with the most ways to go quietly wrong — WHEN IT IS CLEARED.
 *
 * ## Why the clearing cases carry the weight
 *
 * A stale currency does not throw and does not look wrong. It empties a page.
 * Somebody sets "up to 1,200" over a euro city, moves to Kraków, and every
 * assertion about the request still passes while the results narrow to euro
 * listings in a złoty market — an empty area with nothing on screen to explain
 * it, which is the exact failure ADR 0002 forbids for location and which the
 * unit can reproduce on its own. So the bound survives a move and the unit does
 * not, and the server answers it again for the new scope.
 */
import { OfferingType, type LocationSelection } from '@homiio/shared-types';

import { buildPriceHistogramParams, buildSearchParams } from '@/hooks/usePropertySearch';
import { applySearchPatch } from '@/hooks/sindiActionRules';
import { priceBounds, priceTrackFor } from '@/components/search/steps/PriceStep';
import { priceLabel } from '@/components/search/searchLabels';
import { buildSearchParamsForUrl, parseSearchParams } from '@/utils/searchUrl';
import { DEFAULT_SEARCH_QUERY, useSearchQueryStore } from '@/store/searchQueryStore';
import type { SearchQuery } from '@/components/search/types';

function baseQuery(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return { ...DEFAULT_SEARCH_QUERY, ...overrides };
}

const MADRID: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTB' },
  placeType: 'city',
  label: { primary: 'Madrid', secondary: 'Community of Madrid, Spain', kind: 'place' },
  admin: { countryCode: 'ES', regionName: 'Community of Madrid', cityName: 'Madrid' },
  center: { longitude: -3.7038, latitude: 40.4168 },
  precision: 'centroid',
};

const KRAKOW: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
  placeType: 'city',
  label: { primary: 'Kraków', secondary: 'Lesser Poland, Poland', kind: 'place' },
  admin: { countryCode: 'PL', regionName: 'Lesser Poland', cityName: 'Kraków' },
  center: { longitude: 19.9372, latitude: 50.0614 },
  precision: 'centroid',
};

describe('the request carries the unit, and only beside a bound', () => {
  it('emits priceCurrency with the bound', () => {
    const params = buildSearchParams(baseQuery({ priceMax: 1200, priceCurrency: 'PLN' }));
    expect(params.priceMax).toBe(1200);
    expect(params.priceCurrency).toBe('PLN');
  });

  it('emits nothing when there is no bound to give a unit to', () => {
    // A lone currency would narrow the feed to one market on behalf of somebody
    // who set no price at all — and it would split the cache key while doing it.
    const params = buildSearchParams(baseQuery({ priceCurrency: 'PLN' }));
    expect(params.priceCurrency).toBeUndefined();
  });

  it('emits nothing when the query has no unit — which is not "euros"', () => {
    const params = buildSearchParams(baseQuery({ priceMax: 1200 }));
    expect(params.priceMax).toBe(1200);
    expect('priceCurrency' in params).toBe(false);
  });

  it('routes a sale bound to the sale params and still names the unit', () => {
    const params = buildSearchParams(
      baseQuery({ offering: OfferingType.SALE, priceMax: 300000, priceCurrency: 'GBP' }),
    );
    expect(params.maxSalePrice).toBe(300000);
    expect(params.priceCurrency).toBe('GBP');
  });
});

describe('the histogram is drawn in the currency the filter uses', () => {
  it('keeps the unit as `currency` while dropping the bounds', () => {
    const params = buildPriceHistogramParams(
      baseQuery({ priceMin: 400, priceMax: 1200, priceCurrency: 'PLN' }),
    );
    // The bounds go: the bars show where prices sit, not where the thumbs are.
    expect(params.priceMin).toBeUndefined();
    expect(params.priceMax).toBeUndefined();
    expect(params.priceCurrency).toBeUndefined();
    // The unit stays, under the name the endpoint reads. Bars counted in the
    // scope's dominant currency under thumbs filtering another one would be two
    // answers to one question.
    expect(params.currency).toBe('PLN');
  });

  it('asks for no particular currency when the query names none', () => {
    const params = buildPriceHistogramParams(baseQuery({ priceMax: 1200 }));
    expect(params.currency).toBeUndefined();
  });
});

describe('the URL round-trips the unit', () => {
  it('writes it beside a bound and reads it back', () => {
    const { params } = buildSearchParamsForUrl(baseQuery({ priceMax: 1200, priceCurrency: 'PLN' }));
    expect(params.priceMax).toBe('1200');
    expect(params.priceCurrency).toBe('PLN');
    expect(parseSearchParams(params).query.priceCurrency).toBe('PLN');
  });

  it('never writes a lone currency into a shareable link', () => {
    const { params } = buildSearchParamsForUrl(baseQuery({ priceCurrency: 'PLN' }));
    expect(params.priceCurrency).toBeUndefined();
  });

  it('drops a code no listing can be priced in', () => {
    // A link carrying `priceCurrency=XYZ` would otherwise narrow the page to a
    // currency nothing is priced in, which renders as "this area is empty".
    expect(parseSearchParams({ priceMax: '1200', priceCurrency: 'XYZ' }).query.priceCurrency)
      .toBeUndefined();
    // …and the bound survives, to be answered by the scope.
    expect(parseSearchParams({ priceMax: '1200', priceCurrency: 'XYZ' }).query.priceMax).toBe(1200);
  });

  it('reads a link written before the field existed as "nobody said"', () => {
    expect(parseSearchParams({ priceMax: '1200' }).query.priceCurrency).toBeUndefined();
  });
});

describe('a slider commits the currency it was drawn in', () => {
  const track = priceTrackFor(OfferingType.LONG_TERM_RENT);

  it('carries the unit with the bounds', () => {
    expect(priceBounds([500, 1200], track, 'PLN')).toEqual({
      priceMin: 500,
      priceMax: 1200,
      priceCurrency: 'PLN',
    });
  });

  it('drops the unit when both thumbs are at the ends — that is no filter', () => {
    expect(priceBounds([0, track.max], track, 'PLN')).toEqual({
      priceMin: undefined,
      priceMax: undefined,
      priceCurrency: undefined,
    });
  });

  it('commits no unit before a histogram has answered', () => {
    // `undefined` is sent as itself rather than replaced with a default: the
    // server resolves it from the scope, which is the only party with evidence.
    expect(priceBounds([500, 1200], track, undefined).priceCurrency).toBeUndefined();
  });
});

describe('the unit is cleared wherever the question changes', () => {
  beforeEach(() => {
    useSearchQueryStore.setState({ query: DEFAULT_SEARCH_QUERY, pendingViewport: null });
  });

  it('survives nothing about a move, while the bound survives the move', () => {
    const store = useSearchQueryStore.getState();
    store.setPriceRange(undefined, 1200, 'EUR');
    store.commitLocation(KRAKOW);

    const { query } = useSearchQueryStore.getState();
    // "Up to 1,200" is a sentence somebody meant; it follows them.
    expect(query.priceMax).toBe(1200);
    // "Up to 1,200 euros" was only true of the city they said it in.
    expect(query.priceCurrency).toBeUndefined();
  });

  it('clears on clearLocation too', () => {
    const store = useSearchQueryStore.getState();
    store.setPriceRange(undefined, 1200, 'EUR');
    store.commitLocation(KRAKOW);
    useSearchQueryStore.getState().setPriceRange(undefined, 1200, 'PLN');
    useSearchQueryStore.getState().clearLocation();
    expect(useSearchQueryStore.getState().query.priceCurrency).toBeUndefined();
  });

  it('clears when the offering changes, with the range it described', () => {
    const store = useSearchQueryStore.getState();
    store.setPriceRange(undefined, 1200, 'EUR');
    useSearchQueryStore.getState().setOffering(OfferingType.SHORT_TERM_RENT);

    const { query } = useSearchQueryStore.getState();
    expect(query.priceMax).toBeUndefined();
    // The unit was resolved against the monthly column; it does not describe a
    // nightly rate.
    expect(query.priceCurrency).toBeUndefined();
  });

  it('keeps the unit while only the bounds move', () => {
    const store = useSearchQueryStore.getState();
    store.setPriceRange(400, 1200, 'PLN');
    expect(useSearchQueryStore.getState().query.priceCurrency).toBe('PLN');
  });
});

describe('a Sindi patch hands the unit back to the server', () => {
  const inKrakow = baseQuery({ location: KRAKOW, priceMax: 1200, priceCurrency: 'PLN' });

  it('clears the unit when it sets a new price', () => {
    // "Under 900" names an amount and not a unit. Keeping PLN would read the
    // number as złoty because the LAST search happened to be.
    const next = applySearchPatch(inKrakow, { priceMax: 900 });
    expect(next.priceMax).toBe(900);
    expect(next.priceCurrency).toBeUndefined();
  });

  it('clears the unit when it moves the scope', () => {
    const next = applySearchPatch(inKrakow, { queryText: 'loft', location: MADRID });
    // The bound follows the person to the new city; the unit it was resolved
    // against does not.
    expect(next.priceMax).toBe(1200);
    expect(next.priceCurrency).toBeUndefined();
  });

  it('leaves the unit alone when it asks about something else entirely', () => {
    // "Now with two bedrooms" must not re-open a currency question nobody asked.
    const next = applySearchPatch(inKrakow, { bedrooms: 2 });
    expect(next.bedrooms).toBe(2);
    expect(next.priceCurrency).toBe('PLN');
  });
});

describe('the chip says what the filter means', () => {
  const t = ((key: string, options?: { value?: string }) =>
    `${key}:${options?.value ?? ''}`) as never;

  it('formats the bound in the query\'s own currency', () => {
    const label = priceLabel(baseQuery({ priceMax: 1200, priceCurrency: 'PLN' }), t, 'pl');
    // A chip reading "1.200 €" over a search filtering złoty would describe a
    // different search from the one that ran.
    expect(label).toContain('zł');
    expect(label).not.toContain('€');
  });

  it('falls back to the app default only where no scope has answered', () => {
    const label = priceLabel(baseQuery({ priceMax: 1200 }), t, 'es');
    expect(label).toContain('€');
  });
});

describe('the floor chips', () => {
  it('round-trips through a shareable link', () => {
    const { params } = buildSearchParamsForUrl(
      baseQuery({ groundFloor: true, hasElevator: true }),
    );
    expect(params.groundFloor).toBe('true');
    expect(params.hasElevator).toBe('true');

    const parsed = parseSearchParams(params).query;
    expect(parsed.groundFloor).toBe(true);
    expect(parsed.hasElevator).toBe(true);
  });

  it('writes nothing when the chips are off', () => {
    // A `groundFloor=false` in a link is a param that narrows nothing, and the
    // reader would have to decide whether it meant "not ground floor".
    const { params } = buildSearchParamsForUrl(baseQuery({}));
    expect(params.groundFloor).toBeUndefined();
    expect(params.hasElevator).toBeUndefined();
  });

  it('sends them to the search endpoint only when on', () => {
    expect(buildSearchParams(baseQuery({ groundFloor: true })).groundFloor).toBe('true');
    expect(buildSearchParams(baseQuery({})).groundFloor).toBeUndefined();
  });
});

describe('housing features', () => {
  it('round-trips through a shareable link', () => {
    const { params } = buildSearchParamsForUrl(
      baseQuery({ features: ['elevator', 'pool'] }),
    );
    expect(params.features).toBe('elevator,pool');
    expect(parseSearchParams(params).query.features).toEqual(['elevator', 'pool']);
  });

  it('drops a feature this build does not know', () => {
    // A chip from a newer client must not empty an older one's results — the
    // known half still applies, and the unknown one is simply not asked for.
    expect(
      parseSearchParams({ features: 'elevator,teleporter' }).query.features,
    ).toEqual(['elevator']);
  });

  it('writes nothing when none are chosen', () => {
    expect(buildSearchParamsForUrl(baseQuery({})).params.features).toBeUndefined();
    expect(buildSearchParams(baseQuery({ features: [] })).features).toBeUndefined();
  });
});
