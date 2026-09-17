/**
 * What a "where?" control states about the app-wide scope, now that the scope
 * strip above Home is gone and the area lives in the search bar's first segment,
 * its compact trigger and the eviction board's area chip (ADR 0002 principle 2).
 *
 * Every case asserts a statement a reader SEES — or the query a submit RUNS —
 * because the failure this guards is a control that looks fine: an empty
 * segment over a global feed, "Everywhere" over nothing chosen, a disabled row
 * that blames a permission nobody was asked for.
 */
import type { LocationResolution, LocationSelection } from '@homiio/shared-types';

import {
  deviceOptionDescription,
  deviceOptionState,
  scopeStatement,
  scopedSearchQuery,
} from '@/components/location/scopeWhere';
import { DEFAULT_SEARCH_QUERY } from '@/store/searchQueryStore';

const t = (key: string): string => key;
const formatDistanceValue = (metres: number): string => `${metres / 1000} km`;

const BARCELONA: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: 'city-barcelona' },
  placeType: 'city',
  label: { primary: 'Barcelona', kind: 'place' },
  admin: { countryCode: 'ES', cityName: 'Barcelona' },
  precision: 'centroid',
  center: { longitude: 2.1686, latitude: 41.3874 },
};

const IDLE: LocationResolution = { status: 'idle' };
const RESOLVING: LocationResolution = { status: 'resolving' };
const DENIED: LocationResolution = { status: 'failed', reason: 'permission_denied' };

describe('the statement is never a silent empty', () => {
  it('nothing chosen: no value, and the placeholder ASKS for an area', () => {
    expect(
      scopeStatement({ selection: null, isGlobal: false, resolution: IDLE, t, formatDistanceValue }),
    ).toEqual({ value: null, placeholder: 'location.scope.chooseArea' });
  });

  it('location denied: still asks for an area — a failure is not a place and not "everywhere"', () => {
    const statement = scopeStatement({
      selection: null,
      isGlobal: false,
      resolution: DENIED,
      t,
      formatDistanceValue,
    });
    expect(statement.value).toBeNull();
    expect(statement.placeholder).toBe('location.scope.chooseArea');
  });

  it('device fix pending: no value, and the placeholder says it is finding the area', () => {
    expect(
      scopeStatement({ selection: null, isGlobal: false, resolution: RESOLVING, t, formatDistanceValue }),
    ).toEqual({ value: null, placeholder: 'location.scope.resolving' });
  });

  it('a committed city is the VALUE', () => {
    const statement = scopeStatement({
      selection: BARCELONA,
      isGlobal: false,
      resolution: { status: 'resolved', selection: BARCELONA },
      t,
      formatDistanceValue,
    });
    expect(statement.value).toBe('Barcelona');
  });

  it('"Everywhere" is a value ONLY when the user chose it', () => {
    expect(
      scopeStatement({ selection: null, isGlobal: true, resolution: IDLE, t, formatDistanceValue }).value,
    ).toBe('location.scope.everywhere');
    // The floor: the same inputs without the flag must not say it.
    expect(
      scopeStatement({ selection: null, isGlobal: false, resolution: IDLE, t, formatDistanceValue }).value,
    ).not.toBe('location.scope.everywhere');
  });
});

describe('a search bound to the scope never runs the world by accident', () => {
  it('runs the SCOPE, not whatever location the draft carried', () => {
    const draft = { ...DEFAULT_SEARCH_QUERY, location: null };
    expect(scopedSearchQuery(draft, { selection: BARCELONA, isGlobal: false })?.location).toEqual(BARCELONA);
  });

  it('with no area chosen, returns NOTHING to run — the bar asks instead', () => {
    const draft = { ...DEFAULT_SEARCH_QUERY, location: BARCELONA };
    expect(scopedSearchQuery(draft, { selection: null, isGlobal: false })).toBeNull();
  });

  it('runs a location-less query only for an explicit "everywhere"', () => {
    const draft = { ...DEFAULT_SEARCH_QUERY, location: BARCELONA };
    const query = scopedSearchQuery(draft, { selection: null, isGlobal: true });
    expect(query).not.toBeNull();
    expect(query?.location).toBeNull();
  });
});

describe('the "use my location" row', () => {
  const base = {
    source: null,
    resolution: IDLE,
    deviceIssue: null,
    geolocationSupported: true,
  } as const;

  it('is offered, pressable, when nothing has been tried', () => {
    expect(deviceOptionState(base)).toBe('ready');
  });

  it('is hidden where there is no geolocation at all', () => {
    expect(deviceOptionState({ ...base, geolocationSupported: false })).toBe('hidden');
  });

  it('is hidden when the scope already IS the device — the value says so', () => {
    expect(deviceOptionState({ ...base, source: 'device' })).toBe('hidden');
  });

  it('is DISABLED with the reason when permission was denied', () => {
    const state = deviceOptionState({ ...base, resolution: DENIED, deviceIssue: 'permission_denied' });
    expect(state).toBe('denied');
    expect(deviceOptionDescription(state, t, '25 km')).toBe('location.scope.locationOff');
  });

  it('stays disabled with the reason when an AREA is in use and permission is off', () => {
    // The revoked-while-an-area-is-in-use case: the area survives, the row says why.
    expect(
      deviceOptionState({
        ...base,
        source: 'last_chosen',
        resolution: { status: 'resolved', selection: BARCELONA },
        deviceIssue: 'permission_denied',
      }),
    ).toBe('denied');
  });

  it('shows progress, disabled, while a fix is being taken', () => {
    const state = deviceOptionState({ ...base, resolution: RESOLVING });
    expect(state).toBe('locating');
    expect(deviceOptionDescription(state, t, '25 km')).toBe('location.scope.resolving');
  });

  it('offers a RETRY, not a permission complaint, when the fix timed out', () => {
    const state = deviceOptionState({
      ...base,
      resolution: { status: 'failed', reason: 'position_unavailable' },
      deviceIssue: 'position_unavailable',
    });
    expect(state).toBe('retry');
    expect(deviceOptionDescription(state, t, '25 km')).toBe('location.scope.positionRetry');
  });
});
