/**
 * The initial-scope ladder (#353), rung by rung.
 *
 * Every mandatory test case the issue lists for the resolution rules is here,
 * and each is an ordinary assertion over a pure function rather than a timing
 * simulation — see `hooks/locationScopeLadder.ts` for why that was the shape
 * chosen. Two of these could not be written honestly any other way:
 *
 *  - "respuesta tardía de la ubicación anterior que no sobrescribe la nueva"
 *    becomes "a device answer supplied alongside an explicit choice loses",
 *    which is true regardless of when either arrived;
 *  - "nunca ejecutar silenciosamente el feed global" becomes an exhaustive
 *    sweep asserting that NO combination of inputs reaches `isGlobal` except the
 *    one flag a button sets.
 */

import { resolveLocationScope, type DevicePositionState } from '@/hooks/locationScopeLadder';
import type { LocationSelection } from '@homiio/shared-types';

function place(id: string, name: string): LocationSelection {
  return {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id },
    placeType: 'city',
    label: { primary: name, kind: 'place' },
    admin: { countryCode: 'ES', cityName: name },
    precision: 'centroid',
    center: { longitude: 2.1686, latitude: 41.3874 },
  };
}

const BARCELONA = place('city-barcelona', 'Barcelona');
const MADRID = place('city-madrid', 'Madrid');

const DEVICE_FIX: LocationSelection = {
  kind: 'current_location',
  center: { longitude: 26.1025, latitude: 44.4268 },
  radiusMeters: 25_000,
  precision: 'exact',
};

const NOTHING: DevicePositionState = { status: 'idle' };

/** The ladder's inputs with everything absent, for a test to fill in one rung. */
const EMPTY = {
  explicitGlobal: false,
  sessionSelection: null,
  savedAreaSelection: null,
  lastChosenSelection: null,
  device: NOTHING,
} as const;

describe('permission states', () => {
  it('granted: the device position becomes the scope', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(DEVICE_FIX);
    expect(state.source).toBe('device');
    expect(state.canQuery).toBe(true);
    expect(state.isGlobal).toBe(false);
  });

  it('denied: the picker is mandatory and NOTHING may be queried', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'failed', reason: 'permission_denied' },
    });

    expect(state.needsPlace).toBe(true);
    expect(state.canQuery).toBe(false);
    // The whole point: a denial must not become a worldwide list.
    expect(state.isGlobal).toBe(false);
    expect(state.selection).toBeNull();
    // The REASON survives, so the surface can say "location is off" rather than
    // a generic error — "turn on location" is useless advice to somebody whose
    // connection dropped, and the two arrive here as different reasons.
    expect(state.resolution).toEqual({ status: 'failed', reason: 'permission_denied' });
  });

  it('revoked while an area is in use: the area SURVIVES and the loss is reported', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      lastChosenSelection: BARCELONA,
      device: { status: 'failed', reason: 'permission_denied' },
    });

    // "Mantener la última selección válida si existe" …
    expect(state.selection).toEqual(BARCELONA);
    expect(state.canQuery).toBe(true);
    // … and "mostrar que la ubicación actual ya no está disponible". Both at
    // once, which is why the failure is a separate field from the resolution.
    expect(state.deviceIssue).toBe('permission_denied');
    expect(state.resolution).toEqual({ status: 'resolved', selection: BARCELONA });
  });

  it('GPS timeout: the picker, not a global feed', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'failed', reason: 'position_unavailable' },
    });

    expect(state.needsPlace).toBe(true);
    expect(state.canQuery).toBe(false);
    expect(state.isGlobal).toBe(false);
  });

  it('resolving: neither a query nor a picker, so nothing flashes', () => {
    const state = resolveLocationScope({ ...EMPTY, device: { status: 'resolving' } });

    expect(state.canQuery).toBe(false);
    // A picker that opened for the half-second a fix takes would be dismissed on
    // every launch with permission granted.
    expect(state.needsPlace).toBe(false);
    expect(state.resolution).toEqual({ status: 'resolving' });
  });
});

describe('rung order', () => {
  it('an explicit session choice outranks a saved area, the last area and the device', () => {
    const state = resolveLocationScope({
      explicitGlobal: false,
      sessionSelection: MADRID,
      savedAreaSelection: BARCELONA,
      lastChosenSelection: BARCELONA,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(MADRID);
    expect(state.source).toBe('session');
  });

  it('a saved area outranks the last chosen area and the device', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      savedAreaSelection: BARCELONA,
      lastChosenSelection: MADRID,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(BARCELONA);
    expect(state.source).toBe('saved_area');
  });

  it('the last chosen area is restored when nothing above it applies', () => {
    const state = resolveLocationScope({ ...EMPTY, lastChosenSelection: MADRID });

    expect(state.selection).toEqual(MADRID);
    expect(state.source).toBe('last_chosen');
    expect(state.canQuery).toBe(true);
  });

  it('a new user with no saved searches and no permission gets the picker', () => {
    const state = resolveLocationScope(EMPTY);

    expect(state.selection).toBeNull();
    expect(state.needsPlace).toBe(true);
    expect(state.canQuery).toBe(false);
    expect(state.isGlobal).toBe(false);
  });

  it('an absent saved-area rung is a SKIP, not a failure', () => {
    // #356 has landed and the rung is live, but `null` is still its COMMON
    // answer: most people have never marked a primary area. The ladder must fall
    // through it silently rather than treating absence as a problem — otherwise
    // Home would break for everybody who has not set one.
    //
    // The case this does NOT cover is "still loading", which is deliberately not
    // expressible here: `useLocationScope` keeps the two apart and passes
    // `device: { status: 'resolving' }` while the rung is in flight, so the
    // ladder reports `resolving` instead of skipping to a scope it is about to
    // replace.
    const state = resolveLocationScope({
      ...EMPTY,
      savedAreaSelection: null,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.source).toBe('device');
    expect(state.canQuery).toBe(true);
  });
});

describe('a late answer cannot overwrite a newer choice', () => {
  it('a device answer alongside a session choice loses to the choice', () => {
    // This is the "respuesta tardía" case with the timing removed: whenever the
    // device answer arrived, the ladder reads the session rung first, so the
    // device result is not something that CAN displace it.
    const state = resolveLocationScope({
      ...EMPTY,
      sessionSelection: BARCELONA,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(BARCELONA);
    expect(state.source).toBe('session');
  });

  it('a device answer alongside a NEWER session choice for another city still loses', () => {
    // Madrid picked while Barcelona's device-derived scope was in flight.
    const state = resolveLocationScope({
      ...EMPTY,
      sessionSelection: MADRID,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(MADRID);
    // The floor: without this the previous assertion would pass against a ladder
    // that returned the device scope and happened to be compared to it.
    expect(state.selection).not.toEqual(DEVICE_FIX);
  });
});

describe('global is reachable ONLY by the explicit flag', () => {
  it('the explicit flag yields a global scope that may be queried', () => {
    const state = resolveLocationScope({ ...EMPTY, explicitGlobal: true });

    expect(state.isGlobal).toBe(true);
    expect(state.selection).toBeNull();
    expect(state.canQuery).toBe(true);
    expect(state.source).toBe('global');
  });

  it('no OTHER combination of inputs reaches a global scope', () => {
    // The sweep, rather than three or four hand-picked cases: the acceptance
    // criterion is about every path, and enumerating them is the only way to
    // assert "every". Every rung crossed with every device state, with the flag
    // OFF throughout.
    const selections: (LocationSelection | null)[] = [null, BARCELONA, MADRID];
    const devices: DevicePositionState[] = [
      { status: 'idle' },
      { status: 'resolving' },
      { status: 'resolved', selection: DEVICE_FIX },
      { status: 'failed', reason: 'permission_denied' },
      { status: 'failed', reason: 'position_unavailable' },
      { status: 'failed', reason: 'network' },
      { status: 'failed', reason: 'rate_limited' },
      { status: 'failed', reason: 'no_results' },
      { status: 'failed', reason: 'ambiguous' },
      { status: 'failed', reason: 'unsupported' },
    ];

    let checked = 0;
    for (const sessionSelection of selections) {
      for (const savedAreaSelection of selections) {
        for (const lastChosenSelection of selections) {
          for (const device of devices) {
            const state = resolveLocationScope({
              explicitGlobal: false,
              sessionSelection,
              savedAreaSelection,
              lastChosenSelection,
              device,
            });
            expect(state.isGlobal).toBe(false);
            expect(state.source).not.toBe('global');
            // A scope-less state must never be queryable: that combination IS
            // the silent global feed, wearing a different flag.
            if (state.selection === null) expect(state.canQuery).toBe(false);
            checked += 1;
          }
        }
      }
    }

    // A vacuity floor. `expect` inside a loop that never runs passes silently,
    // and a broken generator is indistinguishable from a clean sweep without it.
    expect(checked).toBe(selections.length ** 3 * devices.length);
    expect(checked).toBe(270);
  });
});
